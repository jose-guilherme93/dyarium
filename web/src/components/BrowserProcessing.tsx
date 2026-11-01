import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BROWSER_PLANS,
  LLM_MODELS,
  WHISPER_MODELS,
  formatBytes,
  planDownloadBytes,
  planForTier,
  type BrowserPlan,
  type ProcessingTier,
} from "../lib/browserModels";
import {
  chooseTier,
  webGpuLabel,
  webGpuUsable,
  type HardwareSnapshot,
  type HardwareVerdict,
} from "../lib/hardware";
import { buildLabReport, probeHardware, type LabReport } from "../lib/hardwareProbe";
import {
  getWorkerState,
  startWorker,
  stopWorker,
  subscribeWorker,
} from "../lib/browserWorker";
import {
  allowGpuFor,
  effectiveThreads,
  multithreadAvailable,
  planForSnapshot,
  readBackend,
  readThreadMode,
  resolveWorkerPlan,
  saveBackend,
  saveThreadMode,
  saveWorkerPlan,
  splitCaps,
  threadsFor,
  type LlmBackend,
  type ThreadMode,
} from "../lib/workerSetup";
import { loadDeviceIdentity } from "../lib/deviceIdentity";
import { modelCacheAvailable } from "../lib/browserCache";
import { workerApi, type WorkerStatus } from "../lib/workerApi";
import { ChevronIcon, CpuIcon } from "../components/icons";
import { Spinner } from "../components/Status";
import { Toggle } from "../components/Toggle";

const TIER_LABELS: Record<ProcessingTier, string> = {
  0: "Mínimo",
  1: "Leve",
  2: "Médio",
  3: "Alto",
  4: "Máximo",
};

const BACKEND_LABELS: Record<LlmBackend, string> = {
  auto: "Automático",
  cpu: "CPU",
  gpu: "GPU",
};

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** Estimativa grosseira: o ritmo medio dos blocos ja lidos. */
function etaLabel(job: { read: number; total: number; startedAt: number }): string {
  if (job.read <= 0 || job.total <= job.read) return "";
  const perBlock = (Date.now() - job.startedAt) / job.read;
  const minutes = Math.ceil((perBlock * (job.total - job.read)) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `~${minutes} min restantes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `~${hours} h ${rest} min restantes` : `~${hours} h restantes`;
}

function GPUName({ snapshot }: { snapshot: HardwareSnapshot | null }) {
  if (!snapshot) return <>—</>;
  return (
    <span title={snapshot.webgl.renderer || ""}>
      {snapshot.webgpu.adapter?.description || snapshot.webgl.renderer || "—"}
    </span>
  );
}

function PresenceBadge({ status, running }: { status: WorkerStatus | null; running: boolean }) {
  if (!status) return <span className="lab-badge">—</span>;
  if (status.preferred) return <span className="lab-badge lab-badge--on">analisando</span>;
  if (running) return <span className="lab-badge lab-badge--on">neste PC</span>;
  return <span className="lab-badge">servidor</span>;
}

function Fact({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="lab-fact" title={hint}>
      <span className="lab-fact-label">{label}</span>
      <span className="lab-fact-value">{value}</span>
    </div>
  );
}

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="lab-meter"
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: percent(value) }} />
    </div>
  );
}

function ModelRow({
  label,
  title,
  size,
  hint,
}: {
  label: string;
  title: string;
  size: number;
  hint?: string;
}) {
  return (
    <div className="lab-row" title={hint}>
      <span className="lab-row-label">{label}</span>
      <span className="lab-row-value">{title}</span>
      <span className="lab-row-size">{formatBytes(size)}</span>
    </div>
  );
}

/** Como o motor esta rodando de verdade, nao como o perfil promete. */
function runtimeLabel(
  engine: { backend?: "webgpu" | "cpu" | "wasm"; threads?: number } | null | undefined,
  fallback: string,
): string {
  if (!engine) return fallback;
  if (engine.backend === "webgpu") return "GPU";
  if (engine.backend === "wasm") return "WASM · 1 thread";
  if (engine.backend === "cpu") {
    return engine.threads && engine.threads > 1 ? `CPU · ${engine.threads} threads` : "CPU · 1 thread";
  }
  return fallback;
}

export function BrowserProcessing({ embedded = false, onBack }: { embedded?: boolean; onBack?: () => void } = {}) {
  const [snapshot, setSnapshot] = useState<HardwareSnapshot | null>(null);
  const [verdict, setVerdict] = useState<HardwareVerdict | null>(null);
  const [report, setReport] = useState<LabReport | null>(null);
  const [manualTier, setManualTier] = useState<ProcessingTier | null>(null);
  const [plan, setPlan] = useState<BrowserPlan>(planForTier(0));
  /** Perfil escolhido durante uma analise: aplica quando o worker voltar a esperar. */
  const [pendingRestart, setPendingRestart] = useState<BrowserPlan | null>(null);
  const [testing, setTesting] = useState<"" | "cpu" | "vram">("");
  const [confirming, setConfirming] = useState(false);
  const [proc, setProc] = useState(getWorkerState());
  const [server, setServer] = useState<WorkerStatus | null>(null);
  const [threadMode, setThreadMode] = useState<ThreadMode>(readThreadMode());
  const [backend, setBackend] = useState<LlmBackend>(readBackend());
  const [error, setError] = useState("");
  const [reading, setReading] = useState(true);

  useEffect(() => {
    let alive = true;
    void probeHardware()
      .then((probed) => {
        if (!alive) return;
        // A escolha do usuario volta ao abrir a tela; so sem escolha salva o
        // laboratorio mostra a recomendacao do hardware. Sem isso, um perfil
        // maximo voltava a aparecer como leve depois de navegar para a nota.
        const resolved = resolveWorkerPlan(probed);
        setSnapshot(probed);
        setVerdict(resolved.verdict);
        setPlan(resolved.plan);
        if (resolved.saved) setManualTier(resolved.tier);
      })
      .catch(() => {
        if (alive) setError("Não foi possível ler o hardware deste navegador.");
      })
      .finally(() => {
        if (alive) setReading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const refreshServer = useCallback(async () => {
    try {
      setServer(await workerApi.status());
    } catch {
      // Servidor desligado ou recurso desativado: a tela segue mostrando o
      // hardware local, que nao depende dele.
    }
  }, []);

  useEffect(() => {
    void refreshServer();
    const timer = window.setInterval(() => void refreshServer(), 10_000);
    return () => window.clearInterval(timer);
  }, [refreshServer]);

  useEffect(() => subscribeWorker(setProc), []);

  const running = proc !== null && proc.phase !== "idle" && proc.phase !== "error";
  // Ligado, o cartao de modelos mostra o perfil que o motor abriu de fato. O
  // estado local pode ser a recomendacao da montagem da tela; exibir outro
  // perfil faria o usuario achar que escolheu maximo e rodou leve.
  const activePlan = running && proc?.plan && !pendingRestart ? proc.plan : plan;
  const activeTier = activePlan.tier;
  const httpOnly = typeof window !== "undefined" && window.isSecureContext === false;
  const gpuUsable = snapshot ? webGpuUsable(snapshot) : false;
  const threadTarget = snapshot
    ? effectiveThreads(threadMode, snapshot.cpu.threads)
    : threadsFor(threadMode);
  const gpuForAnalysis = snapshot ? allowGpuFor(snapshot, backend) : false;

  const bootWorker = async (next: BrowserPlan) => {
    if (!snapshot) return;
    setError("");
    await startWorker(
      next,
      splitCaps(snapshot),
      gpuForAnalysis,
      threadTarget,
      loadDeviceIdentity(snapshot),
    );
    void refreshServer();
  };

  const selectTier = (next: ProcessingTier) => {
    const selected = snapshot ? planForSnapshot(next, snapshot) : planForTier(next);
    setManualTier(next);
    setPlan(selected);
    saveWorkerPlan(selected);
    setConfirming(false);
    // Com o worker ligado, trocar de perfil reinicia o motor com o novo plano.
    // Antes o clique nao fazia nada e a proxima analise continuava no modelo
    // anterior, mesmo com "Maximo" marcado. Durante uma nota, espera a passada
    // terminar para nao devolver o job a VPS no meio.
    if (running && snapshot) {
      if (proc?.phase === "working" || proc?.phase === "stopping") {
        setPendingRestart(selected);
      } else {
        void bootWorker(selected);
      }
    }
  };

  useEffect(() => {
    if (!pendingRestart || !snapshot) return;
    if (proc?.phase !== "waiting") return;
    setPendingRestart(null);
    void bootWorker(pendingRestart);
  }, [pendingRestart, proc?.phase, snapshot]);

  const benchmark = async (vram: boolean) => {
    if (!snapshot || testing !== "") return;
    setTesting(vram ? "vram" : "cpu");
    setError("");
    try {
      const next = await buildLabReport(snapshot, { cpu: true, gpu: true, vram });
      setReport(next);
      setSnapshot(next.hardware);
      if (manualTier === null) {
        setVerdict(next.verdict);
        setPlan(planForSnapshot(next.verdict.tier, next.hardware));
      }
    } catch {
      setError("O teste de desempenho não terminou.");
    } finally {
      setTesting("");
    }
  };

  const start = async () => {
    setConfirming(false);
    setPendingRestart(null);
    await bootWorker(plan);
  };

  const stop = async () => {
    setPendingRestart(null);
    await stopWorker();
    setConfirming(false);
    void refreshServer();
  };

  const toggleWorker = (on: boolean) => {
    if (on) {
      setConfirming(true);
      return;
    }
    void stop();
  };

  const exportReport = () => {
    if (!snapshot) return;
    const payload = {
      ...(report ?? {
        hardware: snapshot,
        verdict: verdict ?? chooseTier(snapshot),
        cpuGflops: snapshot.cpu.gflops,
        gpuGflops: null,
        vramProbeGB: null,
        generatedAt: new Date().toISOString(),
      }),
      plan: {
        tier: activePlan.tier,
        label: activePlan.label,
        whisper: activePlan.whisper.id,
        llm: activePlan.llm.id,
        download_bytes: planDownloadBytes(activePlan),
      },
      processing: proc
        ? {
            phase: proc.phase,
            processed: proc.processed,
            failed: proc.failed,
            engine: proc.engine,
            threads: threadTarget,
            backend: gpuForAnalysis ? "gpu-requested" : "cpu",
          }
        : null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dyarium-processamento-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const engineProgress = proc?.engine?.progress ?? -1;
  const downloadBytes = useMemo(() => planDownloadBytes(activePlan), [activePlan]);
  const selectedWhisper = WHISPER_MODELS.find((model) => model.id === activePlan.whisper.id);
  const selectedLlm = LLM_MODELS.find((model) => model.id === activePlan.llm.id);
  const queue = server?.queue ?? {};

  // O selo da execucao usa o motor; parado, usa a escolha do usuario.
  const plannedRuntime = gpuForAnalysis
    ? "GPU"
    : threadTarget > 1
      ? `CPU · ${threadTarget} threads`
      : "1 thread";
  const runtime = runtimeLabel(proc?.engine, plannedRuntime);
  const activeBackend = proc?.engine?.backend;
  const gpuHint = !gpuUsable
    ? "WebGPU indisponível: a análise usa a CPU e a transcrição usa um modelo menor."
    : backend === "cpu"
      ? "A GPU fica de fora; os núcleos da CPU fazem a análise."
      : "A GPU entra quando o runtime suporta; se falhar, a análise cai para a CPU.";

  const mainColumn = (
    <>
          <section className="card lab-card">
            <div className="card-head lab-card-head">
              <h2>Modelos</h2>
              <p className="hint" title="O download é feito uma vez e fica no cache do navegador. Nenhum texto da nota é enviado ao Hugging Face; só os pesos são baixados.">
                {modelCacheAvailable()
                  ? "download único · cache deste navegador"
                  : "este navegador não guarda o modelo"}
              </p>
            </div>

            <div className="segmented lab-tier" role="group" aria-label="Perfil de processamento">
              {BROWSER_PLANS.map((option) => (
                <button
                  key={option.tier}
                  type="button"
                  aria-pressed={activeTier === option.tier}
                  onClick={() => selectTier(option.tier)}
                  disabled={!snapshot}
                  title={option.hardware}
                >
                  {TIER_LABELS[option.tier]}
                </button>
              ))}
            </div>

            <div className="lab-models">
              <ModelRow
                label="Transcrição"
                title={activePlan.whisper.label}
                size={activePlan.whisper.sizeBytes}
                hint={activePlan.whisper.note}
              />
              <ModelRow
                label="Análise"
                title={activePlan.llm.label}
                size={activePlan.llm.sizeBytes}
                hint={activePlan.llm.note}
              />
              <div className="lab-row lab-row--total">
                <span className="lab-row-label">Total</span>
                <span
                  className="lab-row-value"
                  title={`${activePlan.whisper.license} · ${activePlan.llm.license}`}
                >
                  download único
                </span>
                <span className="lab-row-size">{formatBytes(downloadBytes)}</span>
              </div>
            </div>

            <p className="hint lab-profile-note">{planForTier(activeTier).hardware}</p>

            {!gpuUsable && planForTier(activeTier).whisper.id === "whisper-large-v3-turbo" && (
              <p className="hint lab-profile-note">
                Sem WebGPU, a transcrição usa {activePlan.whisper.label}: o modelo grande rodaria
                em uma thread só.
              </p>
            )}
            {!httpOnly && !multithreadAvailable() && (
              <p className="hint lab-profile-note lab-profile-note--warn">
                O proxy não repassa COOP/COEP: a análise fica em uma thread. Libere esses
                cabeçalhos no HTTPS para usar todos os núcleos.
              </p>
            )}

            <details className="lab-advanced">
              <summary>Trocar modelos</summary>
              <label className="lab-field">
                <span>Transcrição</span>
                <select
                  value={activePlan.whisper.id}
                  disabled={running}
                  onChange={(event) => {
                    const whisper = WHISPER_MODELS.find((model) => model.id === event.target.value);
                    if (whisper) {
                      const next = { ...plan, whisper };
                      setManualTier(next.tier);
                      setPlan(next);
                      saveWorkerPlan(next);
                    }
                  }}
                >
                  {WHISPER_MODELS.map((model) => (
                    <option
                      key={model.id}
                      value={model.id}
                      disabled={model.id === "whisper-large-v3-turbo" && !gpuUsable}
                    >
                      {model.label} · {formatBytes(model.sizeBytes)}
                      {model.id === "whisper-large-v3-turbo" && !gpuUsable ? " · exige WebGPU" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="lab-field">
                <span>Análise</span>
                <select
                  value={activePlan.llm.id}
                  disabled={running}
                  onChange={(event) => {
                    const llm = LLM_MODELS.find((model) => model.id === event.target.value);
                    if (llm) {
                      const next = { ...plan, llm };
                      setManualTier(next.tier);
                      setPlan(next);
                      saveWorkerPlan(next);
                    }
                  }}
                >
                  {LLM_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label} · {formatBytes(model.sizeBytes)}
                    </option>
                  ))}
                </select>
              </label>
              {selectedWhisper && selectedLlm && (
                <p className="hint lab-advanced-note">
                  {selectedWhisper.note} {selectedLlm.note}
                </p>
              )}
            </details>
          </section>

          <section className="card lab-card lab-run">
            <div className="lab-run-head">
              <div className="lab-run-title">
                <span className={running ? "lab-dot lab-dot--on" : "lab-dot"} aria-hidden />
                <h2>
                  {proc?.phase === "working"
                    ? "Processando neste PC"
                    : proc?.phase === "preparing"
                      ? "Preparando neste PC"
                      : "Neste PC"}
                </h2>
                <span className="hint">{runtime}</span>
              </div>
              <div className="lab-run-actions">
                <span className="lab-badge">
                  {activeBackend === "cpu" || activeBackend === "wasm"
                    ? "CPU"
                    : gpuForAnalysis
                      ? "GPU"
                      : "CPU"}
                </span>
                <Toggle
                  checked={running}
                  onChange={toggleWorker}
                  ariaLabel="Processar neste computador"
                  label={running ? "ligado" : "desligado"}
                />
              </div>
            </div>

            <div className="lab-power">
              <div className="lab-power-group">
                <span className="lab-power-label">Processador</span>
                <div className="segmented segmented--compact" role="group" aria-label="Processador">
                  {(["auto", "cpu", "gpu"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={backend === option}
                      disabled={running || !snapshot || (option === "gpu" && !gpuUsable)}
                      title={
                        option === "gpu" && !gpuUsable
                          ? "WebGPU não está disponível neste endereço/navegador."
                          : option === "cpu"
                            ? `Usa a CPU com ${threadTarget} threads.`
                            : option === "gpu"
                              ? "Usa o offload de WebGPU quando o runtime suporta."
                              : "GPU quando disponível; CPU quando não."
                      }
                      onClick={() => {
                        setBackend(option);
                        saveBackend(option);
                      }}
                    >
                      {BACKEND_LABELS[option]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="lab-power-group">
                <span className="lab-power-label">Núcleos</span>
                <div className="segmented segmented--compact" role="group" aria-label="Núcleos">
                  <button
                    type="button"
                    aria-pressed={threadMode === "all"}
                    disabled={running || !snapshot || !multithreadAvailable()}
                    title={
                      multithreadAvailable()
                        ? undefined
                        : "Sem SharedArrayBuffer (HTTPS/COOP/COEP) o motor fica em 1 thread."
                    }
                    onClick={() => {
                      setThreadMode("all");
                      saveThreadMode("all");
                    }}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    aria-pressed={threadMode === "half"}
                    disabled={running || !snapshot || !multithreadAvailable()}
                    title={
                      multithreadAvailable()
                        ? undefined
                        : "Sem SharedArrayBuffer (HTTPS/COOP/COEP) o motor fica em 1 thread."
                    }
                    onClick={() => {
                      setThreadMode("half");
                      saveThreadMode("half");
                    }}
                  >
                    Metade
                  </button>
                </div>
              </div>
            </div>
            {running && (proc?.phase === "working" || proc?.phase === "preparing") && (
              <p className="hint lab-run-hint">
                O interruptor desliga depois desta nota. Para devolver agora, use no servidor na
                nota.
              </p>
            )}
            {httpOnly && (
              <p className="hint lab-run-hint lab-run-hint--warn">
                HTTP limita a 1 thread. Abra este dashboard por HTTPS para usar os{" "}
                {snapshot?.cpu.threads ?? "núcleos"} núcleos e a WebGPU. Os modelos já ficam no
                IndexedDB.
              </p>
            )}

            {!running && !confirming && (
              <>
                <p className="lab-run-models">
                  <span>{activePlan.whisper.label}</span>
                  <span className="lab-plus">+</span>
                  <span>{activePlan.llm.label}</span>
                </p>
                <div className="lab-chips">
                  <span className="lab-chip" title="Download total dos dois modelos, feito ao ligar neste PC.">
                    {formatBytes(downloadBytes)} · download único
                  </span>
                  <span className="lab-chip" title={gpuHint}>{runtime}</span>
                  <span className="lab-chip" title="As notas só rodam aqui quando você pede Analisar; o resto fica com a VPS.">
                    sob demanda
                  </span>
                </div>
                <p className="hint lab-run-hint">
                  Ligar baixa os dois modelos do perfil e deixa a máquina pronta, sem ocupar a
                  fila. Eles ficam no cache deste navegador.
                </p>
                <button
                  type="button"
                  className="button button--primary lab-start"
                  onClick={() => setConfirming(true)}
                  disabled={!snapshot || reading || (verdict !== null && !verdict.fullSupport)}
                >
                  <CpuIcon size={16} />
                  Ligar neste PC
                </button>
              </>
            )}

            {confirming && (
              <div className="lab-confirm" role="group" aria-label="Confirmar download">
                <div className="lab-confirm-main">
                  <strong>{formatBytes(downloadBytes)}</strong>
                  <span className="hint">
                    na primeira vez. Depois fica no cache deste navegador.
                  </span>
                </div>
                <p className="hint">
                  {plan.whisper.label} + {plan.llm.label}. Só a nota que você mandar analisar
                  roda aqui; o resto continua na VPS. Mantenha a aba aberta.
                </p>
                <div className="lab-actions">
                  <button type="button" className="button button--primary button--small" onClick={() => void start()}>
                    Baixar e ligar
                  </button>
                  <button type="button" className="button button--ghost button--small" onClick={() => setConfirming(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {running && (
              <>
                <div className="lab-run-status">
                  <span className="lab-badge lab-badge--on">
                    {proc?.phase === "working"
                      ? "processando"
                      : proc?.phase === "preparing"
                        ? "preparando"
                        : proc?.phase === "stopping"
                          ? "parando"
                          : "aguardando"}
                  </span>
                  <span className="hint">
                    {proc?.engine
                      ? proc.engine.stage === "ready"
                        ? (proc.engine.detail ?? "modelos prontos")
                        : `${proc.engine.detail ?? activePlan.llm.label} · ${percent(Math.max(0, engineProgress))}`
                      : "pronto para a próxima nota"}
                  </span>
                </div>

                {proc?.engine && proc.engine.stage !== "ready" && (
                  <Meter value={Math.max(0, engineProgress)} label="Download do modelo" />
                )}

                {proc?.job ? (
                  <div className="lab-job">
                    <div className="lab-job-head">
                      <span className="lab-badge">{proc.job.type === "transcribe" ? "transcrição" : "análise"}</span>
                      <span className="lab-job-title">{proc.job.title || "…"}</span>
                      <span className="hint">{proc.job.stage}</span>
                    </div>
                    {proc.job.total > 0 && (
                      <>
                        <Meter value={proc.job.read / proc.job.total} label="Blocos lidos" />
                        <div className="lab-job-foot">
                          <span>
                            {proc.job.read} / {proc.job.total} blocos
                          </span>
                          <span>
                            {compactNumber(proc.job.tokensPerSecond)} tok/s
                            {etaLabel(proc.job) ? ` · ${etaLabel(proc.job)}` : ""}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="hint lab-run-hint">
                    Nenhuma nota pedida agora. O servidor segue a fila; use <strong>Analisar</strong> em
                    uma nota para trazê-la para cá.
                  </p>
                )}

                <div className="lab-chips">
                  <span className="lab-chip" title="Backend e threads que o motor abriu de fato.">
                    {runtime}
                  </span>
                  {activeBackend === "webgpu" && gpuForAnalysis && (
                    <span className="lab-chip">offload de GPU</span>
                  )}
                </div>
              </>
            )}

            {proc && proc.debug.length > 0 && proc.phase !== "working" && (
              <details className="lab-debug">
                <summary>Blocos sem itens ({proc.debug.length})</summary>
                {proc.debug.map((sample) => (
                  <div key={sample.blockIndex} className="lab-debug-item">
                    <span className="hint">
                      bloco {sample.blockIndex} · JSON {sample.parsed ? "ok" : "inválido"} · {sample.items} itens
                    </span>
                    <pre>{sample.raw || "(vazio)"}</pre>
                  </div>
                ))}
              </details>
            )}

            {proc?.phase === "error" && (
              <div className="lab-error lab-error--inline" role="alert">
                {proc.lastError}
                <button type="button" className="button button--ghost button--small" onClick={() => void stop()}>
                  Limpar
                </button>
              </div>
            )}
          </section>

    </>
  );

  if (embedded) {
    return (
      <div className="lab lab--embedded">
        {error !== "" && (
          <div className="lab-error" role="alert">
            {error}
          </div>
        )}
        <div className="lab-column lab-column--main">{mainColumn}</div>
      </div>
    );
  }

  return (
    <div className="lab">
      <header className="lab-head">
        {onBack && (
          <button type="button" className="page-back" onClick={onBack} aria-label="Voltar" title="Voltar">
            <ChevronIcon size={16} />
          </button>
        )}
        <div className="lab-head-main">
          <h1>Processamento</h1>
          <div className="lab-head-facts">
            {snapshot ? (
              <>
                <span>
                  {snapshot.browser.name}
                  {snapshot.browser.version ? ` ${snapshot.browser.version}` : ""}
                </span>
                <span className="lab-sep" aria-hidden />
                <span className="lab-head-gpu" title={snapshot.webgl.renderer || ""}>
                  <GPUName snapshot={snapshot} />
                </span>
                <span className="lab-sep" aria-hidden />
                <span>{snapshot.cpu.threads} núcleos</span>
                <span className="lab-sep" aria-hidden />
                <span title={`WebGPU: ${webGpuLabel(snapshot)}`}>
                  WebGPU {webGpuLabel(snapshot)}
                </span>
                {httpOnly && (
                  <>
                    <span className="lab-sep" aria-hidden />
                    <span className="lab-head-warn">HTTP · 1 thread</span>
                  </>
                )}
              </>
            ) : reading ? (
              <span>
                <Spinner /> Lendo este computador…
              </span>
            ) : (
              <span>Hardware indisponível</span>
            )}
          </div>
        </div>
        <PresenceBadge status={server} running={running} />
      </header>

      {error !== "" && (
        <div className="lab-error" role="alert">
          {error}
        </div>
      )}

      <div className="lab-layout">
        <div className="lab-column lab-column--main">
          {mainColumn}
        </div>

        <div className="lab-column lab-column--side">
          <section className="card lab-card lab-machine">
            <div className="card-head lab-card-head">
              <h2>Este computador</h2>
              <p className="hint" title={verdict?.warnings.join(" ") || "Medido no navegador."}>
                {verdict?.reason ?? "—"}
              </p>
            </div>
            <div className="lab-facts">
              <Fact label="GPU" value={<GPUName snapshot={snapshot} />} hint={snapshot?.webgl.renderer} />
              <Fact
                label="VRAM"
                value={
                  snapshot?.memory.vramGB !== null && snapshot?.memory.vramGB !== undefined
                    ? `${compactNumber(snapshot.memory.vramGB)} GB`
                    : "—"
                }
              />
              <Fact
                label="RAM"
                value={
                  snapshot?.memory.deviceMemoryGB
                    ? `≥ ${compactNumber(snapshot.memory.deviceMemoryGB)} GB`
                    : snapshot?.memory.heapLimitGB
                      ? `≈ ${compactNumber(snapshot.memory.heapLimitGB)} GB`
                      : "—"
                }
              />
              <Fact label="Núcleos" value={snapshot?.cpu.threads ?? "—"} />
              <Fact
                label="Em uso"
                value={runtime}
                hint="Threads e backend que o motor abriu. Sem WebGPU, a transcrição fica em uma thread."
              />
              <Fact
                label="WebGPU"
                value={snapshot ? webGpuLabel(snapshot) : "—"}
                hint={
                  snapshot?.webgpu.available
                    ? "WebGPU disponível neste endereço."
                    : "Sem WebGPU aqui: HTTPS é obrigatório, ou o navegador/driver não oferece."
                }
              />
              <Fact
                label="CPU"
                value={
                  snapshot?.cpu.gflops !== null && snapshot?.cpu.gflops !== undefined
                    ? `${compactNumber(snapshot.cpu.gflops)} GFLOPs`
                    : "—"
                }
              />
              <Fact label="GPU GFLOPs" value={compactNumber(report?.gpuGflops)} />
              <Fact
                label="Espaço"
                value={snapshot?.storage.quotaGB ? `${compactNumber(snapshot.storage.quotaGB)} GB` : "—"}
              />
            </div>

            {verdict && verdict.warnings.length > 0 && (
              <ul className="lab-warnings">
                {verdict.warnings.map((warning) => (
                  <li key={warning}>
                    <span className="lab-dot" aria-hidden />
                    {warning}
                  </li>
                ))}
              </ul>
            )}

            <div className="lab-actions lab-actions--tight">
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void benchmark(false)}
                disabled={testing !== "" || running}
              >
                {testing === "cpu" ? "Medindo…" : "Medir CPU e GPU"}
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void benchmark(true)}
                disabled={testing !== "" || running || !snapshot?.webgpu.available}
                title="Aloca buffers até o limite. Pode demorar e exige WebGPU."
              >
                {testing === "vram" ? "Medindo…" : "Testar VRAM"}
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={exportReport}
                disabled={!snapshot}
              >
                Exportar
              </button>
            </div>
          </section>

          <section className="card lab-card lab-queue">
            <div className="card-head lab-card-head">
              <h2>Fila</h2>
              <p className="hint">{server?.preferred ? "A VPS aguarda esta análise." : "A VPS processa o resto."}</p>
            </div>
            <div className="lab-queue-grid">
              <Fact label="Na fila" value={queue.queued ?? "—"} />
              <Fact label="Em curso" value={queue.running ?? "—"} />
              <Fact label="Tentando" value={queue.retrying ?? "—"} />
              <Fact label="Paradas" value={queue.dead ?? "—"} />
              <Fact label="Feitas aqui" value={proc?.processed ?? 0} />
              <Fact label="Falhas aqui" value={proc?.failed ?? 0} />
            </div>
            {proc?.lastError && proc.phase !== "error" && <p className="hint">{proc.lastError}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
