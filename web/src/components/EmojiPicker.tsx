import { useEffect, useRef, useState } from "react";

/**
 * Seletor de emoji da entry (icone do projeto), extraido de ProjectsView para
 * ser usado pelos dois pontos que trocam icone: a linha do projeto e o cabecalho
 * da nota (ProjectNote). Mesma aparencia do prototipo (proto-resumos.html,
 * .pop/.pg); o popup e fixo, colado no botao que o abriu.
 */

interface EmojiPickerProps {
  /** Retangulo do botao que abriu o popup; a janela do popup sai dele. */
  anchor: DOMRect;
  /** Emoji atualmente escolhido (pressed na grade). */
  current: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/** Popup do seletor de emoji, largura e altura incluindo o campo de busca. */
const POP_W = 296;
const POP_H = 322;

/* Emojis do seletor, com o nome de busca (o norm tira o acento na comparação). */
const EMOJIS: Array<[string, string]> = [
  ["✒️", "tinta"], ["📓", "diário"], ["📗", "caderno"], ["📘", "caderno azul"],
  ["📒", "fichário"], ["📕", "livro"], ["📖", "leitura"], ["📚", "estante"],
  ["📝", "anotação"], ["✏️", "lápis"], ["🖋", "caneta"], ["🖊", "marcador"],
  ["🖌", "pincel"], ["🎨", "paleta"], ["🧭", "bússola"], ["🗺️", "mapa"],
  ["🧠", "mente"], ["💡", "ideia"], ["⚙️", "engrenagem"], ["🔧", "chave inglesa"],
  ["🛠️", "ferramentas"], ["🪛", "chave de fenda"], ["📊", "gráfico"], ["📈", "crescimento"],
  ["📉", "queda"], ["💰", "dinheiro"], ["💳", "cartão"], ["🪙", "moeda"],
  ["🏦", "banco"], ["💸", "gasto"], ["🧾", "recibo"], ["🌿", "folha"],
  ["🌱", "broto"], ["🌳", "árvore"], ["🍂", "outono"], ["🌸", "flor"],
  ["🏠", "casa"], ["🌐", "globo"], ["🔍", "lupa"], ["🗂️", "organizador"],
  ["📁", "pasta"], ["📂", "pasta aberta"], ["🗃️", "arquivo"], ["🗄️", "arquivo grande"],
  ["✅", "feito"], ["🕰️", "relógio"], ["⌛", "tempo"], ["🧩", "quebra-cabeça"],
  ["🧪", "teste"], ["🔬", "ciência"], ["🔔", "sino"], ["📮", "correio"],
  ["🎧", "fone"], ["🎯", "alvo"], ["🧵", "linha"], ["🧱", "tijolo"],
  ["🪨", "pedra"], ["🌊", "onda"], ["🔥", "fogo"], ["💨", "vento"],
  ["⚡", "relâmpago"], ["☁️", "nuvem"], ["🌙", "lua"], ["☀️", "sol"],
  ["⭐", "estrela"], ["🌠", "cometa"], ["🚀", "foguete"], ["🏷️", "etiqueta"],
  ["🔑", "chaveiro"], ["🔒", "cadeado"], ["🔓", "cadeado aberto"], ["📦", "pacote"],
  ["📥", "entrada"], ["📤", "saída"], ["🔗", "link"], ["🪢", "nó"],
  ["🧮", "contas"], ["🪜", "escada"], ["🚪", "porta"], ["🪟", "janela"],
];

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Posicao do popup colada no anchor, sempre dentro da janela. */
function popupSpot(anchor: DOMRect): { left: number; top: number } {
  if (typeof window === "undefined") return { left: 8, top: 8 };
  return {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - POP_W - 8)),
    top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - POP_H)),
  };
}

export function EmojiPicker({ anchor, current, onPick, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  // Esc fecha, clique fora fecha (mousedown, para o mesmo clique do botao de
  // abrir nao reabrir).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: MouseEvent) => {
      if (popRef.current && event.target instanceof Node && !popRef.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const { left, top } = popupSpot(anchor);

  return (
    <div className="pj-pop" ref={popRef} style={{ left, top }}>
      <input
        type="text"
        placeholder="Buscar"
        aria-label="buscar emoji"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="pj-pg">
        {EMOJIS.filter(([, name]) => !query || norm(name).includes(norm(query))).map(
          ([emoji, name]) => (
            <button
              key={emoji}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={current === emoji}
              onClick={() => onPick(emoji)}
            >
              {emoji}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
