import { useCallback, useEffect, useMemo, useState } from "react";
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
  hardwareSummary,
  webGpuLabel,
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
  multithreadAvailable,
  readThreadMode,
  saveThreadMode,
  saveWorkerPlan,
  splitCaps,
  threadsFor,
  type ThreadMode,
} from "../lib/workerSetup";
import { loadDeviceIdentity } from "../lib/deviceIdentity";
import { browserCacheAvailable } from "../lib/browserCache";
import { workerApi, type WorkerStatus } from "../lib/workerApi";
import { ChevronIcon, CpuIcon } from "../components/icons";
import { Spinner } from "../components/Status";

const TIER_LABELS = BROWSER_PLANS.map((plan) => `${plan.tier} · ${plan.label}`);

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
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

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="lab-meter" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: percent(value) }} />
    </div>
  );
}

function PresenceBadge({ status, running }: { status: WorkerStatus | null; running: boolean }) {
  if (!status) {
    return <span className="lab-badge">—</span>;
  }
  if (status.preferred) {
    return <span className="lab-badge lab-badge--on">analisando</span>;
  }
  if (running) {
    return <span className="lab-badge lab-badge--on">neste PC</span>;
  }
  return <span className="lab-badge">servidor</span>;
}

export function LabView({ onBack }: { onBack?: () => void } = {}) {
  const [snapshot, setSnapshot] = useState<HardwareSnapshot | null>(null);
  const [verdict, setVerdict] = useState<HardwareVerdict | null>(null);
  const [report, setReport] = useState<LabReport | null>(null);
  const [tier, setTier] = useState<ProcessingTier>(0);
  const [manualTier, setManualTier] = useState<ProcessingTier | null>(null);
  const [plan, setPlan] = useState<BrowserPlan>(planForTier(0));
  const [testing, setTesting] = useState<"" | "cpu" | "vram">("");
  const [confirming, setConfirming] = useState(false);
  const [proc, setProc] = useState(getWorkerState());
  const [server, setServer] = useState<WorkerStatus | null>(null);
  const [threadMode, setThreadMode] = useState<ThreadMode>(readThreadMode());
  const [error, setError] = useState("");
  const [reading, setReading] = useState(true);

  useEffect(() => {
    let alive = true;
    void probeHardware()
      .then((probed) => {
        if (!alive) return;
        const chosen = chooseTier(probed);
        // Sem contexto isolado nao ha SharedArrayBuffer: o motor fica em uma
        // thread e um modelo grande nao termina em tempo util.
        const recommended = multithreadAvailable()
          ? chosen.tier
          : (Math.min(chosen.tier, 0) as ProcessingTier);
        setSnapshot(probed);
        setVerdict(chosen);
        setTier(recommended);
        setPlan(planForTier(recommended));
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

  const selectTier = (next: ProcessingTier) => {
    if (running) return;
    const selected = planForTier(next);
    setManualTier(next);
    setTier(next);
    setPlan(selected);
    saveWorkerPlan(selected);
    setConfirming(false);
  };

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
        setTier(next.verdict.tier);
        setPlan(planForTier(next.verdict.tier));
      }
    } catch {
      setError("O teste de desempenho não terminou.");
    } finally {
      setTesting("");
    }
  };

  const start = async () => {
    if (!snapshot) return;
    setError("");
    setConfirming(false);
    const softwareGpu = verdict?.gpu?.label === "GPU de software";
    await startWorker(
      plan,
      splitCaps(snapshot),
      snapshot.webgpu.available && !softwareGpu,
      threadsFor(readThreadMode(), snapshot.cpu.threads),
      loadDeviceIdentity(snapshot),
    );
    void refreshServer();
  };

  const stop = async () => {
    await stopWorker();
    setConfirming(false);
    void refreshServer();
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
        tier: plan.tier,
        label: plan.label,
        whisper: plan.whisper.id,
        llm: plan.llm.id,
        download_bytes: planDownloadBytes(plan),
      },
      processing: proc
        ? {
            phase: proc.phase,
            processed: proc.processed,
            failed: proc.failed,
            engine: proc.engine,
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

  const running = proc !== null && proc.phase !== "idle" && proc.phase !== "error";

  const engineProgress = proc?.engine?.progress ?? -1;
  const downloadBytes = useMemo(() => planDownloadBytes(plan), [plan]);
  const selectedWhisper = WHISPER_MODELS.find((model) => model.id === plan.whisper.id);
  const selectedLlm = LLM_MODELS.find((model) => model.id === plan.llm.id);
  const queue = server?.queue ?? {};

  return (
    <div className="lab">
      <header className="page-head">
        {onBack && (
          <button type="button" className="page-back" onClick={onBack} aria-label="Voltar" title="Voltar">
            <ChevronIcon size={16} />
          </button>
        )}
        <div>
          <h1>Processamento</h1>
          <p title="O servidor continua transcrevendo e analisando como hoje. Este modo só age enquanto esta aba estiver aberta.">
            {snapshot ? (
              hardwareSummary(snapshot)
            ) : reading ? (
              <>
                <Spinner /> Lendo este computador…
              </>
            ) : (
              "Hardware indisponível"
            )}
          </p>
        </div>
        <PresenceBadge status={server} running={running} />
      </header>

      {error !== "" && (
        <div className="lab-error" role="alert">
          {error}
        </div>
      )}

      <section className="card lab-card">
        <div className="card-head">
          <h2>Este computador</h2>
          <p className="hint">
            Perfil {tier} · {plan.label} · {verdict?.reason ?? "—"}
          </p>
        </div>

        <div className="lab-grid">
          <div className="lab-metric">
            <span className="lab-metric-label">Navegador</span>
            <span className="lab-metric-value">
              {snapshot ? `${snapshot.browser.name} ${snapshot.browser.version}` : "—"}
            </span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">GPU</span>
            <span className="lab-metric-value" title={snapshot?.webgl.renderer || ""}>
              {snapshot?.webgpu.adapter?.description ||
                snapshot?.webgl.renderer ||
                "—"}
            </span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">VRAM</span>
            <span className="lab-metric-value">
              {snapshot?.memory.vramGB !== null && snapshot?.memory.vramGB !== undefined
                ? `${compactNumber(snapshot.memory.vramGB)} GB`
                : "—"}
            </span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">RAM</span>
            <span className="lab-metric-value">
              {snapshot?.memory.deviceMemoryGB
                ? `≥ ${compactNumber(snapshot.memory.deviceMemoryGB)} GB`
                : snapshot?.memory.heapLimitGB
                  ? `≈ ${compactNumber(snapshot.memory.heapLimitGB)} GB`
                  : "—"}
            </span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">Núcleos</span>
            <span className="lab-metric-value">{snapshot?.cpu.threads ?? "—"}</span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">CPU</span>
            <span className="lab-metric-value">
              {snapshot?.cpu.gflops !== null && snapshot?.cpu.gflops !== undefined
                ? `${compactNumber(snapshot.cpu.gflops)} GFLOPs`
                : "—"}
            </span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">WebGPU</span>
            <span
              className="lab-metric-value"
              title={
                snapshot?.webgpu.available
                  ? "WebGPU disponível neste endereço."
                  : "Sem WebGPU aqui: HTTPS é obrigatório, ou o navegador/driver não oferece."
              }
            >
              {snapshot ? webGpuLabel(snapshot) : "—"}
            </span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">GPU GFLOPs</span>
            <span className="lab-metric-value">{compactNumber(report?.gpuGflops)}</span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">Threads WASM</span>
            <span className="lab-metric-value">
              {snapshot?.features.sharedArrayBuffer ? (snapshot.features.crossOriginIsolated ? "sim" : "1 núcleo") : "não"}
            </span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">Espaço</span>
            <span className="lab-metric-value">
              {snapshot?.storage.quotaGB ? `${compactNumber(snapshot.storage.quotaGB)} GB` : "—"}
            </span>
          </div>
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

        <div className="lab-actions">
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
            Exportar relatório
          </button>
        </div>
      </section>

      <section className="card lab-card">
        <div className="card-head">
          <h2>Modelos</h2>
          <p
            className="hint"
            title="O download é feito uma vez e fica no cache do navegador. Nenhum texto da nota é enviado ao Hugging Face; só os pesos são baixados."
          >
            {browserCacheAvailable()
              ? "Download único · fica neste navegador"
              : "Sem HTTPS, o download se repete"}
          </p>
        </div>

        <div className="segmented lab-tier" role="group" aria-label="Perfil de processamento">
          {BROWSER_PLANS.map((option) => (
            <button
              key={option.tier}
              type="button"
              aria-pressed={tier === option.tier}
              onClick={() => selectTier(option.tier)}
              disabled={running}
              title={option.hardware}
            >
              {TIER_LABELS[option.tier]}
            </button>
          ))}
        </div>

        <div className="lab-models">
          <ModelRow
            label="Transcrição"
            title={plan.whisper.label}
            size={plan.whisper.sizeBytes}
            hint={plan.whisper.note}
          />
          <ModelRow
            label="Análise"
            title={plan.llm.label}
            size={plan.llm.sizeBytes}
            hint={plan.llm.note}
          />
          <div className="lab-row lab-row--total">
            <span className="lab-row-label">Total</span>
            <span className="lab-row-value" title={`${plan.whisper.license} · ${plan.llm.license}`}>
              download único
            </span>
            <span className="lab-row-size">{formatBytes(downloadBytes)}</span>
          </div>
        </div>

        <p className="hint lab-profile-note">{planForTier(tier).hardware}</p>
        {!multithreadAvailable() && (
          <p
            className="hint lab-profile-note"
            title="`SharedArrayBuffer` exige HTTPS com COOP/COEP. Sem ele, o llama.cpp e o ONNX usam uma thread: prefira o perfil mínimo aqui ou analise no servidor."
          >
            Sem HTTPS, o processamento usa uma thread
          </p>
        )}

        <details className="lab-advanced">
          <summary>Trocar modelo</summary>
          <label className="lab-field">
            <span>Transcrição</span>
            <select
              value={plan.whisper.id}
              disabled={running}
              onChange={(event) => {
                const whisper = WHISPER_MODELS.find((model) => model.id === event.target.value);
                if (whisper) {
                  const next = { ...plan, whisper };
                  setPlan(next);
                  saveWorkerPlan(next);
                }
              }}
            >
              {WHISPER_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} · {formatBytes(model.sizeBytes)}
                </option>
              ))}
            </select>
          </label>
          <label className="lab-field">
            <span>Análise</span>
            <select
              value={plan.llm.id}
              disabled={running}
              onChange={(event) => {
                const llm = LLM_MODELS.find((model) => model.id === event.target.value);
                if (llm) {
                  const next = { ...plan, llm };
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
          <label className="lab-field">
            <span>Núcleos</span>
            <select
              value={threadMode}
              disabled={running}
              onChange={(event) => {
                const next = event.target.value === "half" ? "half" : "all";
                setThreadMode(next);
                saveThreadMode(next);
              }}
            >
              <option value="all">Todos ({snapshot?.cpu.threads ?? "—"})</option>
              <option value="half">
                Metade ({threadsFor("half", snapshot?.cpu.threads)})
              </option>
            </select>
          </label>
          {selectedWhisper && selectedLlm && (
            <p className="hint">
              {selectedWhisper.note} {selectedLlm.note}
            </p>
          )}
        </details>

        {!running && !confirming && (
          <button
            type="button"
            className="button button--primary lab-start"
            onClick={() => setConfirming(true)}
            disabled={!snapshot || reading || (verdict !== null && !verdict.fullSupport)}
          >
            <CpuIcon size={16} />
            Processar neste PC
          </button>
        )}

        {confirming && (
          <div className="lab-confirm" role="group" aria-label="Confirmar download">
            <div>
              <strong>{formatBytes(downloadBytes)}</strong>
              <span className="hint"> serão baixados e ficarão no cache deste navegador.</span>
            </div>
            <p className="hint">
              {plan.whisper.label} + {plan.llm.label}. A VPS só sai do caminho enquanto
              este PC processa a nota que você pedir; o resto continua nela. Mantenha
              esta aba aberta.
            </p>
            <div className="lab-actions">
              <button type="button" className="button button--primary button--small" onClick={() => void start()}>
                Baixar e começar
              </button>
              <button type="button" className="button button--ghost button--small" onClick={() => setConfirming(false)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {running && (
          <div className="lab-running">
            <div className="lab-running-head">
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
                    : `${proc.engine.detail ?? plan.llm.label} · ${percent(Math.max(0, engineProgress))}`
                  : plan.llm.label}
              </span>
            </div>
            {proc?.engine && proc.engine.stage !== "ready" && <Meter value={Math.max(0, engineProgress)} label="Download do modelo" />}
            {proc?.job && (
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
                        {proc.job.read} / {proc.job.total}
                      </span>
                      <span>{compactNumber(proc.job.tokensPerSecond)} tok/s</span>
                    </div>
                  </>
                )}
              </div>
            )}
            <button type="button" className="button button--ghost button--small" onClick={() => void stop()}>
              Parar após esta nota
            </button>
          </div>
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
          <div className="lab-error" role="alert">
            {proc.lastError}
            <button type="button" className="button button--ghost button--small" onClick={() => void stop()}>
              Limpar
            </button>
          </div>
        )}
      </section>

      <section className="card lab-card">
        <div className="card-head">
          <h2>Fila</h2>
          <p className="hint">{server?.preferred ? "A VPS aguarda esta análise." : "A VPS processa o resto."}</p>
        </div>
        <div className="lab-grid lab-grid--queue">
          <div className="lab-metric">
            <span className="lab-metric-label">Na fila</span>
            <span className="lab-metric-value">{queue.queued ?? "—"}</span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">Em curso</span>
            <span className="lab-metric-value">{queue.running ?? "—"}</span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">Tentando</span>
            <span className="lab-metric-value">{queue.retrying ?? "—"}</span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">Paradas</span>
            <span className="lab-metric-value">{queue.dead ?? "—"}</span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">Feitas aqui</span>
            <span className="lab-metric-value">{proc?.processed ?? 0}</span>
          </div>
          <div className="lab-metric">
            <span className="lab-metric-label">Falhas aqui</span>
            <span className="lab-metric-value">{proc?.failed ?? 0}</span>
          </div>
        </div>
        {proc?.lastError && proc.phase !== "error" && <p className="hint">{proc.lastError}</p>}
      </section>
    </div>
  );
}
