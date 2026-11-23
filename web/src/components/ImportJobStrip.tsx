import { useEffect, useState } from "react";

// A linha e a mesma peca das Configuracoes, como a do Drive; a folha vem junto
// para `.cfg-item`/`.cfg-mark` nao dependerem da tela de Configuracoes.
import "../views/settings.css";
import {
  dismissImportJob,
  importJobState,
  subscribeImportJob,
  type ImportJobState,
} from "../local/importJob";
import { useToast } from "./Toasts";

/** Estados ja avisados no toast; cada tarefa avisa uma vez so. */
const avisados = new WeakSet<object>();

function notas(quantidade: number): string {
  return quantidade === 1 ? "1 nota" : `${quantidade.toLocaleString("pt-BR")} notas`;
}

function cadernos(quantidade: number): string {
  return quantidade === 1 ? "1 caderno" : `${quantidade.toLocaleString("pt-BR")} cadernos`;
}

function capas(quantidade: number): string {
  return quantidade === 1 ? "1 capa" : `${quantidade.toLocaleString("pt-BR")} capas`;
}

function audios(quantidade: number): string {
  return quantidade === 1 ? "1 áudio" : `${quantidade.toLocaleString("pt-BR")} áudios`;
}

function transcricoes(quantidade: number): string {
  return quantidade === 1
    ? "1 transcrição"
    : `${quantidade.toLocaleString("pt-BR")} transcrições`;
}

function analises(quantidade: number): string {
  return quantidade === 1 ? "1 análise" : `${quantidade.toLocaleString("pt-BR")} análises`;
}

/** Nota que falhou por inteiro; o que entrou nao se perde por causa dela. */
function comErro(quantidade: number): string {
  return `${quantidade.toLocaleString("pt-BR")} com erro`;
}

/** Causa em uma linha: o aviso nao pode virar paragrafo. */
function causaCurta(mensagem: string): string {
  // O status cru do HTTP nao ajuda quem esta olhando as notas.
  if (/^40[13]\b/.test(mensagem)) return "token recusado";
  const falha = /^5\d\d\b/.exec(mensagem);
  if (falha) return `servidor falhou (${falha[0]})`;
  // O caminho da API tambem nao: sobra a causa.
  const semCaminho = mensagem.replace(/\s+em\s+\S+$/, "");
  const limpa = semCaminho.replace(/\s+/g, " ").trim();
  return limpa.length > 88 ? `${limpa.slice(0, 87).trimEnd()}…` : limpa;
}

/**
 * A faixa da importacao do servidor, abaixo da linha do Drive.
 *
 * A tarefa roda fora do dialogo; esta linha e o unico lugar que conta o
 * progresso sem prender a tela. Marca, texto e numero, como a linha do Drive:
 * preenchida no fim, contorno enquanto trabalha, aviso quando parou. O aviso do
 * projeto entra uma vez, no fim, para a pessoa saber mesmo olhando outra nota.
 */
export function ImportJobStrip() {
  const [estado, setEstado] = useState<ImportJobState>(importJobState);
  const { notify } = useToast();

  useEffect(() => subscribeImportJob(() => setEstado(importJobState())), []);

  useEffect(() => {
    if (estado.status !== "done" && estado.status !== "error") return;
    // A identidade do estado guarda o aviso: remontar a faixa nao repete.
    if (avisados.has(estado)) return;
    avisados.add(estado);
    if (estado.status === "done") {
      const total = estado.result.total;
      const partes = [`${notas(total)} ${total === 1 ? "importada" : "importadas"}`];
      if (estado.result.notebooks > 0) partes.push(cadernos(estado.result.notebooks));
      if (estado.result.covers > 0) partes.push(capas(estado.result.covers));
      if (estado.result.audios > 0) partes.push(audios(estado.result.audios));
      if (estado.result.transcripts > 0) partes.push(transcricoes(estado.result.transcripts));
      if (estado.result.analyses > 0) partes.push(analises(estado.result.analyses));
      if (estado.result.failed > 0) partes.push(comErro(estado.result.failed));
      notify(partes.join(" · "), "success");
    } else {
      notify(`importação parou · ${causaCurta(estado.message)}`, "error");
    }
  }, [estado, notify]);

  if (estado.status === "idle") return null;

  const rodando = estado.status === "running";
  const pronto = estado.status === "done";
  const total = rodando ? estado.total : pronto ? estado.result.total : 0;
  const pct =
    rodando && estado.total > 0
      ? Math.min(100, Math.max(0, (estado.done / estado.total) * 100))
      : 0;
  const causa = estado.status === "error" ? causaCurta(estado.message) : "";
  const anuncio = pronto
    ? `${notas(total)} ${total === 1 ? "importada" : "importadas"}`
    : causa
      ? `importação parou · ${causa}`
      : "";

  return (
    <section className="import-job-strip" aria-label="Importação do servidor">
      <div className="cfg-item">
        <span
          className="cfg-mark import-job-mark"
          data-state={rodando ? "run" : pronto ? "on" : "warn"}
          aria-hidden="true"
        />
        {estado.status === "error" ? (
          <span className="cfg-grow import-job-error">{causa}</span>
        ) : (
          <span className="cfg-grow">
            {rodando && total === 0 ? "Importando" : notas(total)}
            {rodando && total > 0 && (
              <span className="cfg-meta import-job-num">
                {" · "}
                {estado.done.toLocaleString("pt-BR")}
              </span>
            )}
            {pronto && estado.result.notebooks > 0 && (
              <span className="cfg-meta import-job-num">
                {" · "}
                {cadernos(estado.result.notebooks)}
              </span>
            )}
            {pronto && estado.result.covers > 0 && (
              <span className="cfg-meta import-job-num">
                {" · "}
                {capas(estado.result.covers)}
              </span>
            )}
            {pronto && estado.result.audios > 0 && (
              <span className="cfg-meta import-job-num">
                {" · "}
                {audios(estado.result.audios)}
              </span>
            )}
            {pronto && estado.result.transcripts > 0 && (
              <span className="cfg-meta import-job-num">
                {" · "}
                {transcricoes(estado.result.transcripts)}
              </span>
            )}
            {pronto && estado.result.analyses > 0 && (
              <span className="cfg-meta import-job-num">
                {" · "}
                {analises(estado.result.analyses)}
              </span>
            )}
            {pronto && estado.result.failed > 0 && (
              <span className="cfg-meta import-job-num">
                {" · "}
                {comErro(estado.result.failed)}
              </span>
            )}
          </span>
        )}
        {estado.status === "error" && (
          <button
            type="button"
            className="cfg-btn cfg-btn--quiet"
            onClick={() => dismissImportJob()}
          >
            fechar
          </button>
        )}
      </div>
      <div
        className="vault-boot-meter import-job-meter"
        data-idle={rodando && total > 0 ? "false" : "true"}
        aria-hidden="true"
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      {/* So o fim entra na regiao viva: contar nota por nota seria ruido. */}
      <span className="sr-only" aria-live="polite">
        {anuncio}
      </span>
    </section>
  );
}

export default ImportJobStrip;
