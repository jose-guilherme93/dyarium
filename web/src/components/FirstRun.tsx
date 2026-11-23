import { useEffect, useState } from "react";
import { preloadGoogle } from "../local/google";
import { pickFolder, supportsFolder, type FolderLike } from "../local/folder";

interface FirstRunProps {
  /** Pasta escolhida e pronta para virar cofre. */
  onFolderChosen: (folder: FolderLike) => void | Promise<void>;
  /** Seguir sem cofre em pasta (só neste navegador). */
  onUseBrowserOnly: () => void;
  /** Abrir o caminho da instância própria (token). */
  onSelfHosted: () => void;
  /** Google ainda desligado: botão visível e inerte. */
  googleReady?: boolean;
  /** Login no Google deu certo e o cofre precisa abrir no Drive. */
  onDriveChosen?: () => Promise<void>;
}

type View = "entry" | "folder" | "browser";

/** Waveform determinística do protótipo: mesmas barras, mesma posição. */
function waveBars(): { x: number; y: number; h: number; played: boolean }[] {
  const bars: { x: number; y: number; h: number; played: boolean }[] = [];
  for (let i = 0; i < 54; i++) {
    const env =
      Math.abs(Math.sin(i * 0.55)) * 0.8 + Math.abs(Math.sin(i * 0.21 + 1.3)) * 0.55;
    const h = Math.min(40, Math.max(4, 5 + env * 20 + (i % 9 === 0 ? 4 : 0)));
    bars.push({ x: 2 + i * 5, y: (44 - h) / 2, h, played: i < 24 });
  }
  return bars;
}
const WAVE_BARS = waveBars();

/** O seletor do Chromium rejeita com DOMException("...", "AbortError") no cancelamento. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

/**
 * Causa do Drive em uma linha. As mensagens do DriveClient comecam com o
 * status HTTP, entao o caso comum (API desligada no projeto) tem texto proprio
 * em vez do JSON cru.
 *
 * Exportada porque a linha de reconectar (`DriveReconnect`) fala a mesma coisa
 * quando o login ou o cofre falham. O movimento menor e este: primeiro acesso e
 * reconexao sao as duas unicas telas que traduzem erro do Drive, e um modulo
 * proprio so para nove linhas nao pagaria o arquivo novo.
 */
export function describeDriveError(causa: unknown): string {
  const texto = causa instanceof Error ? causa.message : "";
  if (/^Drive 403/.test(texto)) return "Sem permissão no Drive. A Drive API pode estar desligada no projeto.";
  if (/^Drive 401/.test(texto)) return "A sessão do Google venceu. Conecte de novo.";
  if (/nao respondeu|popup|bloquead/i.test(texto)) return "A janela do Google não abriu. Tente de novo.";
  if (/recusad|cancelad/i.test(texto)) return "Login cancelado.";
  return "Não foi possível abrir o cofre do Drive. Tente de novo.";
}

// FirstRun é a primeira tela do site: o produto à esquerda, o acesso à direita.
// Com client id configurado o Google abre o cofre no Drive; sem ele o botão
// aparece desligado, como a promessa aprovada no protótipo. Quem decide o que
// vem depois de cada escolha é o App.
export function FirstRun({
  onFolderChosen,
  onUseBrowserOnly,
  onSelfHosted,
  googleReady = false,
  onDriveChosen,
}: FirstRunProps) {
  const [view, setView] = useState<View>("entry");
  const [folder, setFolder] = useState<FolderLike | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [error, setError] = useState("");

  const folderCapable = supportsFolder();

  // Esc volta à entrada, como no protótipo.
  useEffect(() => {
    if (view === "entry") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setView("entry");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  // O popup do Google so abre dentro do gesto do usuario: o script do GIS
  // precisa chegar antes do clique, nao durante.
  useEffect(() => {
    if (googleReady) void preloadGoogle();
  }, [googleReady]);

  const chooseFolder = async () => {
    setError("");
    setView("folder");
    setPicking(true);
    try {
      setFolder(await pickFolder());
    } catch (err) {
      // Cancelar não é falha: volta ao estado inicial sem erro.
      setView("entry");
      if (!isAbortError(err)) setError("Não foi possível abrir a pasta. Tente de novo.");
    } finally {
      setPicking(false);
    }
  };

  const repickFolder = async () => {
    setError("");
    setPicking(true);
    try {
      setFolder(await pickFolder());
    } catch (err) {
      if (!isAbortError(err)) setError("Não foi possível abrir a pasta. Tente de novo.");
    } finally {
      setPicking(false);
    }
  };

  const createVault = async () => {
    if (!folder) return;
    setCreating(true);
    setError("");
    try {
      await onFolderChosen(folder);
    } catch {
      setError("Não foi possível criar o cofre. Tente de novo.");
    } finally {
      setCreating(false);
    }
  };

  const chooseDrive = async () => {
    if (!onDriveChosen) return;
    setDriveBusy(true);
    setError("");
    try {
      await onDriveChosen();
    } catch (causa) {
      // O motivo tecnico fica no console; na tela vai a causa em uma linha,
      // porque "tente de novo" nao diz o que consertar.
      console.error("[drive] falha ao abrir o cofre", causa);
      setError(describeDriveError(causa));
    } finally {
      setDriveBusy(false);
    }
  };

  return (
    <main className="first-run-page">
      <section className="first-run-pitch">
        <h1 className="first-run-title">dyarium</h1>
        <p className="first-run-position">
          Notas e áudios que viram texto, análise e grafo, no seu Drive.
        </p>

        <ul className="first-run-facts">
          <li>
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4.6 11.2a2.9 2.9 0 0 1-.3-5.8A3.6 3.6 0 0 1 11 4.7a2.6 2.6 0 0 1 .4 5.2" />
              <path d="M5.5 13.5h5.8M6.8 15.2h3.2" />
            </svg>
            fica no seu Drive
          </li>
          <li>
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M2 6v4M4.2 4.2v7.6M6.4 7v2M8.6 3.4v9.2" />
              <path d="M11.4 5h3M11.4 8h3M11.4 11h2" />
            </svg>
            áudio vira texto
          </li>
          <li>
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2.4" y="2.4" width="11.2" height="4.4" rx="1.2" />
              <rect x="2.4" y="9.2" width="11.2" height="4.4" rx="1.2" />
              <path d="M4.6 4.6h.01M4.6 11.4h.01M12.8 3.2 3.2 12.8" />
            </svg>
            nada fica num servidor nosso
          </li>
        </ul>

        {/* imagem mental do produto: áudio → transcrição → análise → grafo */}
        <figure
          className="first-run-scene"
          role="img"
          aria-label="Nota de áudio com waveform virando transcrição; a transcrição alimenta um painel de análise com pessoas, lugares, temas e sentimento, e um grafo de relações entre eles."
        >
          <div className="first-run-scene-inner">
            <div className="first-run-panel">
              <div className="first-run-note-head">
                <span className="first-run-note-ic" aria-hidden="true">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <rect x="6" y="1.8" width="4" height="7.4" rx="2" />
                    <path d="M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v2.2" />
                  </svg>
                </span>
                <span className="first-run-note-name">Gravação da manhã</span>
                <span className="first-run-note-dur">4:12</span>
                <span className="first-run-note-when">hoje 08:12</span>
              </div>

              <div className="first-run-wave-row">
                <svg
                  className="first-run-wave"
                  viewBox="0 0 280 44"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <g>
                    {WAVE_BARS.map((bar, index) => (
                      <rect
                        key={index}
                        x={Number(bar.x.toFixed(1))}
                        y={Number(bar.y.toFixed(1))}
                        width="2.6"
                        height={Number(bar.h.toFixed(1))}
                        rx="1.3"
                        className={bar.played ? "first-run-w-on" : "first-run-w-off"}
                      />
                    ))}
                  </g>
                  <line className="first-run-w-head" x1="124.5" y1="1" x2="124.5" y2="43" />
                </svg>
                <span className="first-run-wave-time">1:47</span>
              </div>

              <div className="first-run-trill">
                <time>00:04</time>
                <p>
                  Liguei para a <span className="first-run-ent">Marina</span> sobre a mudança.
                </p>
                <time>00:21</time>
                <p>
                  Ela prefere sábado de manhã, lá em{" "}
                  <span className="first-run-ent">Pinheiros</span>.
                </p>
                <time>00:46</time>
                <p>
                  Fechar o <span className="first-run-ent">orçamento</span> com o{" "}
                  <span className="first-run-ent">Rui</span> até sexta.
                </p>
              </div>
            </div>

            <svg
              className="first-run-flow"
              viewBox="0 0 400 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M200 0 V6" />
              <path d="M200 6 Q200 12 194 12 H110 Q104 12 104 18 V24" />
              <path d="M200 6 Q200 12 206 12 H290 Q296 12 296 18 V24" />
            </svg>

            <div className="first-run-scene-row">
              <div className="first-run-panel">
                <div className="first-run-plabel">
                  Análise <span className="first-run-mono">4 itens</span>
                </div>

                <div className="first-run-arow">
                  <span className="first-run-alabel">Pessoas</span>
                  <div className="first-run-chips">
                    <span className="first-run-chip">
                      Marina <b>12</b>
                    </span>
                    <span className="first-run-chip">
                      Rui <b>5</b>
                    </span>
                  </div>
                </div>
                <div className="first-run-arow">
                  <span className="first-run-alabel">Lugares</span>
                  <div className="first-run-chips">
                    <span className="first-run-chip">
                      Pinheiros <b>3</b>
                    </span>
                    <span className="first-run-chip first-run-more">+2</span>
                  </div>
                </div>
                <div className="first-run-arow">
                  <span className="first-run-alabel">Temas</span>
                  <div className="first-run-chips">
                    <span className="first-run-chip">
                      mudança <b>8</b>
                    </span>
                    <span className="first-run-chip">
                      orçamento <b>4</b>
                    </span>
                    <span className="first-run-chip first-run-more">+3</span>
                  </div>
                </div>
                <div className="first-run-arow">
                  <span className="first-run-alabel">Sentimento</span>
                  <div className="first-run-meter">
                    <span className="first-run-track">
                      <span className="first-run-fill" />
                    </span>
                    <span className="first-run-num">7,2</span>
                  </div>
                </div>
              </div>

              <div className="first-run-panel first-run-graph-panel">
                <div className="first-run-plabel">
                  Grafo <span className="first-run-mono">312 nós</span>
                </div>
                <svg viewBox="0 0 280 128" aria-hidden="true">
                  <g className="first-run-g-edge">
                    <line x1="112" y1="58" x2="46" y2="30" />
                    <line x1="112" y1="58" x2="196" y2="34" />
                    <line x1="112" y1="58" x2="186" y2="98" />
                    <line x1="112" y1="58" x2="64" y2="100" />
                    <line x1="112" y1="58" x2="136" y2="22" />
                    <line x1="136" y1="22" x2="196" y2="34" />
                    <line x1="196" y1="34" x2="246" y2="66" />
                    <line x1="186" y1="98" x2="246" y2="66" />
                    <line x1="64" y1="100" x2="46" y2="30" />
                    <line x1="186" y1="98" x2="228" y2="108" />
                    <line x1="246" y1="66" x2="228" y2="108" />
                  </g>
                  <circle cx="46" cy="30" r="6.5" fill="var(--graph-person)" />
                  <circle cx="112" cy="58" r="10" fill="var(--graph-person)" />
                  <circle cx="196" cy="34" r="7.5" fill="var(--graph-place)" />
                  <circle cx="246" cy="66" r="5.5" fill="var(--graph-place)" />
                  <circle cx="186" cy="98" r="6.5" fill="var(--graph-theme)" />
                  <circle cx="64" cy="100" r="6.5" fill="var(--graph-theme)" />
                  <circle cx="136" cy="22" r="3" fill="var(--graph-note)" />
                  <circle cx="228" cy="108" r="3" fill="var(--graph-note)" />
                  <g className="first-run-g-label">
                    <text x="112" y="82">
                      Marina
                    </text>
                    <text x="46" y="20">
                      Rui
                    </text>
                    <text x="196" y="22">
                      Pinheiros
                    </text>
                    <text x="246" y="55">
                      Padaria
                    </text>
                    <text x="186" y="114">
                      mudança
                    </text>
                    <text x="64" y="116">
                      orçamento
                    </text>
                  </g>
                </svg>
                <div className="first-run-legend">
                  <span>
                    <i className="first-run-dot" style={{ background: "var(--graph-person)" }} />
                    pessoa
                  </span>
                  <span>
                    <i className="first-run-dot" style={{ background: "var(--graph-place)" }} />
                    lugar
                  </span>
                  <span>
                    <i className="first-run-dot" style={{ background: "var(--graph-theme)" }} />
                    tema
                  </span>
                  <span>
                    <i className="first-run-dot" style={{ background: "var(--graph-note)" }} />
                    nota
                  </span>
                </div>
              </div>
            </div>
          </div>
        </figure>
      </section>

      <section className="first-run-access" aria-live="polite">
        <div className="first-run-access-inner">
          <div className="first-run-stage" key={view}>
            {view === "entry" && (
              <>
                <div className="first-run-google-row">
                  <button
                    type="button"
                    className="first-run-btn first-run-btn-primary"
                    disabled={!googleReady || driveBusy}
                    onClick={googleReady ? () => void chooseDrive() : undefined}
                  >
                    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
                      <g fill="currentColor">
                        <path d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
                        <path d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
                        <path d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.96 21.96 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
                        <path d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2A21.96 21.96 0 0 0 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
                      </g>
                    </svg>
                    {driveBusy ? "Conectando ao Drive…" : "Continuar com Google"}
                  </button>
                  {!googleReady && <span className="first-run-soon">em breve</span>}
                </div>

                <div className="first-run-rule">ou use só neste computador</div>

                {folderCapable ? (
                  <button
                    type="button"
                    className="first-run-btn first-run-btn-outline"
                    onClick={chooseFolder}
                  >
                    Escolher pasta…
                  </button>
                ) : (
                  <button
                    type="button"
                    className="first-run-btn first-run-btn-outline"
                    onClick={() => setView("browser")}
                  >
                    Seguir neste navegador
                  </button>
                )}

                {folderCapable ? (
                  <p className="first-run-fine">
                    As notas ficam só neste navegador; outro computador não as recupera. Entrar
                    com Google depois leva tudo para o Drive.
                  </p>
                ) : (
                  <p className="first-run-fine">
                    O cofre fica só aqui, e o backup é um arquivo que você baixa; outro
                    computador não as recupera.
                  </p>
                )}

                {error && (
                  <p className="first-run-error" role="alert">
                    {error}
                  </p>
                )}

                {folderCapable && (
                  <div className="first-run-tiny-links">
                    <button
                      type="button"
                      className="first-run-linkbtn"
                      onClick={() => setView("browser")}
                    >
                      Usar só neste navegador
                    </button>
                  </div>
                )}
              </>
            )}

            {view === "folder" && (
              <>
                <button
                  type="button"
                  className="first-run-linkbtn first-run-back"
                  onClick={() => setView("entry")}
                >
                  ← Voltar
                </button>

                {picking ? (
                  <div className="first-run-thinking">
                    <span className="first-run-spinner" aria-hidden="true" />
                    Abrindo seletor de pasta…
                  </div>
                ) : (
                  folder && (
                    <>
                      <div className="first-run-pathbox">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M1.8 12.6V3.4c0-.6.5-1.2 1.2-1.2h3l1.6 1.8h4.8c.7 0 1.2.6 1.2 1.2v7.4c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" />
                        </svg>
                        <span className="first-run-path">{folder.name}</span>
                        <span className="first-run-state">
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M3 8.5 6.3 12 13 4.8" />
                          </svg>
                          escolhida
                        </span>
                      </div>

                      <p className="first-run-fine">
                        O cofre fica espelhado nesta pasta. Nada sobe enquanto você não entrar
                        com Google.
                      </p>

                      {error && (
                        <p className="first-run-error" role="alert">
                          {error}
                        </p>
                      )}

                      <div className="first-run-folder-actions">
                        <button
                          type="button"
                          className="first-run-btn first-run-btn-primary"
                          autoFocus
                          disabled={creating}
                          onClick={createVault}
                        >
                          {creating ? "Criando cofre…" : "Criar cofre aqui"}
                        </button>
                        <button type="button" className="first-run-linkbtn" onClick={repickFolder}>
                          Trocar pasta
                        </button>
                      </div>
                    </>
                  )
                )}
              </>
            )}

            {view === "browser" && (
              <>
                <button
                  type="button"
                  className="first-run-linkbtn first-run-back"
                  onClick={() => setView("entry")}
                >
                  ← Voltar
                </button>

                <p className="first-run-fine">
                  As notas ficam só neste navegador; outro computador não as recupera.
                </p>

                <button
                  type="button"
                  className="first-run-btn first-run-btn-primary"
                  autoFocus
                  onClick={onUseBrowserOnly}
                >
                  Continuar
                </button>
              </>
            )}
          </div>

          <div className="first-run-own-row">
            <button
              type="button"
              className="first-run-linkbtn first-run-own"
              onClick={onSelfHosted}
            >
              Já tenho uma instalação própria
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default FirstRun;
