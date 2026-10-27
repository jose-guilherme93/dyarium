package analyze

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/joseti/dyarium/internal/review"
)

// ReviseOptions configures the transcript revision pass.
type ReviseOptions struct {
	// Literal keeps hesitations and stutters in the text. When false, only the
	// fillers without meaning are removed.
	Literal bool
	// Title is the entry title, used as context to expand an ambiguous acronym.
	Title string
	// Window is the number of segments per call. Zero means review.ServerWindow.
	Window int
	// OnWindow, when set, is called after every window with the accepted texts
	// for that range (empty string means "keep the original") and the number of
	// segments rejected so far. It lets the caller persist and publish the pass
	// window by window instead of waiting for the whole transcript. A returned
	// error aborts the pass.
	OnWindow func(start, end int, texts []string, rejected int) error
}

// Revision is the outcome of the revision pass. Texts is aligned with the input
// segments: an empty entry means the original text is kept (unchanged, rejected
// or failed window). Comprehension is -1 when no window returned one.
type Revision struct {
	Texts         []string
	Comprehension int
	Rejected      int
	Failed        int
}

// Changed counts how many segments actually got a new text.
func (r Revision) Changed() int {
	changed := 0
	for _, text := range r.Texts {
		if text != "" {
			changed++
		}
	}
	return changed
}

// Revise cleans the language of the transcript segments, window by window. A
// window that changes the number of lines is discarded whole; a segment that
// breaks a guardrail keeps its original text. A failure before any window
// succeeded returns an error, so the caller can skip the revision entirely; a
// later failure only leaves that window as it was.
func (p *Pipeline) Revise(ctx context.Context, segments []Segment, opts ReviseOptions, progress func(stage string, done, total int)) (Revision, error) {
	window := opts.Window
	if window <= 0 {
		window = review.ServerWindow
	}
	result := Revision{Texts: make([]string, len(segments)), Comprehension: -1}
	report := func(done, total int) {
		if progress != nil {
			progress("reviewing", done, total)
		}
	}
	total := (len(segments) + window - 1) / window
	report(0, total)
	comprehensionSum, comprehensionWeight := 0, 0
	succeeded := 0
	for start := 0; start < len(segments); start += window {
		end := start + window
		if end > len(segments) {
			end = len(segments)
		}
		contextText := ""
		if start > 0 {
			// O contexto e o texto aceito da janela anterior (revisado quando
			// houve mudanca), para a sigla explicada nao se repetir.
			contextText = strings.TrimSpace(segments[start-1].Text)
			if revised := result.Texts[start-1]; revised != "" {
				contextText = strings.TrimSpace(revised)
			}
		}
		texts, comprehension, err := p.reviseWindow(ctx, segments[start:end], opts, contextText)
		windowTexts := make([]string, end-start)
		if err != nil {
			if succeeded == 0 {
				return Revision{}, fmt.Errorf("analyze: revisao: %w", err)
			}
			result.Failed += end - start
		} else {
			succeeded++
			for i, revised := range texts {
				original := strings.TrimSpace(segments[start+i].Text)
				if ok, _ := review.Accept(original, revised); !ok {
					result.Rejected++
					continue
				}
				if normalized(revised) == normalized(original) {
					continue
				}
				result.Texts[start+i] = revised
			}
			if comprehension >= 0 {
				weight := 0
				for _, segment := range segments[start:end] {
					weight += len([]rune(strings.TrimSpace(segment.Text)))
				}
				if weight == 0 {
					weight = 1
				}
				comprehensionSum += comprehension * weight
				comprehensionWeight += weight
			}
		}
		report((start+window)/window, total)
		if opts.OnWindow != nil {
			copy(windowTexts, result.Texts[start:end])
			if err := opts.OnWindow(start, end, windowTexts, result.Rejected+result.Failed); err != nil {
				return Revision{}, fmt.Errorf("analyze: revisao: %w", err)
			}
		}
	}
	if comprehensionWeight > 0 {
		result.Comprehension = comprehensionSum / comprehensionWeight
	}
	return result, nil
}

// normalized collapses whitespace for the "did anything change" comparison.
func normalized(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

// reviseWindow sends one window and parses the model's answer. It requires one
// string per input segment; anything else is an error, never a guess.
func (p *Pipeline) reviseWindow(ctx context.Context, segments []Segment, opts ReviseOptions, contextText string) ([]string, int, error) {
	payload := map[string]any{
		"trechos": make([]string, len(segments)),
	}
	if title := strings.TrimSpace(opts.Title); title != "" {
		payload["titulo"] = title
	}
	if contextText != "" {
		payload["contexto"] = contextText
	}
	trechos := payload["trechos"].([]string)
	for i, segment := range segments {
		trechos[i] = strings.TrimSpace(segment.Text)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, -1, err
	}
	content, err := p.client.doWithSchema(ctx,
		reviseSystemPrompt(p.client.cfg.Language, opts.Literal),
		string(raw), 300+220*len(segments), "transcript_revision", reviseSchemaJSON)
	if err != nil {
		return nil, -1, err
	}
	parsed, err := decodeJSONRepair[revisePayload](content)
	if err != nil {
		return nil, -1, fmt.Errorf("decode revisao: %w", err)
	}
	if len(parsed.Segments) != len(segments) {
		return nil, -1, fmt.Errorf("revisao devolveu %d trechos para %d", len(parsed.Segments), len(segments))
	}
	comprehension := parsed.Comprehension
	if comprehension < 0 {
		comprehension = -1
	}
	if comprehension > 100 {
		comprehension = 100
	}
	return parsed.Segments, comprehension, nil
}

type revisePayload struct {
	Comprehension int      `json:"comprehension"`
	Segments      []string `json:"segments"`
}

const reviseSchemaJSON = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["comprehension", "segments"],
  "properties": {
    "comprehension": {"type": "integer"},
    "segments": {"type": "array", "items": {"type": "string"}}
  }
}`

// reviseSystemPrompt builds the reviser prompt. The rules are the product
// contract: whisper listens, the model only fixes the language, and the way the
// person speaks survives.
func reviseSystemPrompt(language string, literal bool) string {
	fillers := `Remova apenas hesitacao sem significado ("ee", "hum", "aa") e repeticao de gagueira ("eu eu falei"),` +
		` preservando todo marcador de fala com sentido: "tipo", "ne", "mermao", "cara", "ai".`
	if literal {
		fillers = `Mantenha hesitacoes ("ee", "hum", "aa") e repeticoes de gagueira ("eu eu falei"):` +
			` elas fazem parte do que foi dito.`
	}
	return fmt.Sprintf(`Voce revisa a transcricao automatica de um diario pessoal falado.
O whisper escuta o audio; seu trabalho e somente limpar a lingua, sem reescrever o conteudo.
Corrija ortografia, concordancia nominal e verbal, regencia, pontuacao, reticencias e maiusculas.
%s
Preserve o jeito de falar: gírias, marcadores de fala e o ritmo das frases continuam.
Explique uma sigla ambigua entre parenteses, no maximo uma por trecho e com ate 6 palavras,
somente quando o titulo ou o contexto deixarem claro o significado: "pt" vira "PT (Partido dos Trabalhadores)".
Nunca invente fatos, nomes, numeros ou datas, e nunca apague numeros do texto.
Nao junte nem divida trechos: devolva exatamente o mesmo numero de textos, na mesma ordem, um por trecho recebido.
Se um trecho ja estiver correto, devolva-o sem mudanca.
Responda SOMENTE com um JSON valido no formato
{"comprehension": <0 a 100>, "segments": ["<trecho revisado>", "..."]}.
"comprehension" e uma estimativa textual de 0 a 100 de quanto o texto cru representa a fala com logica,
sintaxe e concordancia: 100 para um texto perfeito, 0 para um texto incompreensivel. Voce nao ouve o audio.
Escreva no idioma %s.`, fillers, languageName(language))
}
