import type { StepProgress } from "../local/backup";
import type { VaultStage } from "../local/vaultCloud";

/**
 * Tela de carregamento do cofre, do desenho aprovado em
 * `web/prototypes/vault-boot.html`.
 *
 * A linguagem e a do carregamento de nota: circulo de 12 px girando, uma linha
 * de 14 px ("Carregando…"), o detalhe da etapa em 13 px e, so quando existe
 * contagem, um medidor de 2 px. Nada de card, sombra ou emoji.
 *
 * Quem decide quando acabou e o App: ele passa `done` e desmonta o componente
 * ao entrar no app. Assim o componente nao guarda tempo nenhum de saida — o
 * `done` troca o desenho para o disco com traco, segura "pronto" por 0,9 s e
 * some em 0,3 s (os ~1,2 s do prototipo, no CSS).
 */
interface VaultBootProps {
  /** Etapa que o cofre esta atravessando; quem emite e o `vaultCloud`. */
  stage: VaultStage;
  /** Contagem real da etapa; so "aplicando" e "anexos" tem numero. */
  progress?: StepProgress;
  /** O cofre abriu: disco com traco e a linha "pronto". */
  done?: boolean;
  /**
   * Sinal discreto do segundo plano: sem a linha "Carregando…", so o circulo,
   * a etapa e o medidor. A tela ja abriu; isto e um aviso, nao uma espera.
   */
  quiet?: boolean;
}

/** O que a tela diz em cada etapa, tres palavras por linha. */
function etapa(stage: VaultStage): string {
  switch (stage) {
    case "conectando":
      return "entrando com o Google";
    case "lendo":
      return "lendo o cofre";
    case "decifrando":
      return "abrindo o retrato";
    case "aplicando":
      return "aplicando as notas";
    case "anexos":
      return "guardando os anexos";
    case "sincronizando":
      return "gravando o que mudou";
  }
}

/** Etapas que contam item por item; fora delas o medidor nao aparece. */
function contaItens(stage: VaultStage): boolean {
  return stage === "aplicando" || stage === "anexos";
}

export function VaultBoot({ stage, progress, done = false, quiet = false }: VaultBootProps) {
  const total = progress?.total ?? 0;
  const conta = !done && contaItens(stage) && total > 0;
  const feito = conta ? Math.min(Math.max(progress?.done ?? 0, 0), total) : 0;
  const unidade = stage === "anexos" ? "anexos" : "notas";
  const pct = conta ? (feito / total) * 100 : 0;

  return (
    <div className="vault-boot-page" aria-busy={done ? "false" : "true"}>
      <div className="vault-boot-column">
        <div className="vault-boot" data-done={done ? "true" : "false"}>
          <p className="vault-boot-head">
            <span
              className={done ? "vault-boot-glyph is-done" : "vault-boot-glyph"}
              aria-hidden="true"
            />
            {!done && !quiet && <span>Carregando…</span>}
          </p>
          <p className="vault-boot-detail" aria-live="polite">
            {/* A chave troca so quando a etapa muda: a linha entra com um
                aceno de opacidade e a contagem de dentro nao repinta. */}
            <span className="vault-boot-fresh" key={done ? "pronto" : stage}>
              {done ? (
                "pronto"
              ) : conta ? (
                <>
                  <b>{feito}</b> de {total} {unidade}
                </>
              ) : (
                etapa(stage)
              )}
            </span>
          </p>
          {/* O espaco do medidor fica reservado: sem contagem ele some da vista
              sem empurrar a linha de baixo. */}
          <div className="vault-boot-meter" data-idle={conta ? "false" : "true"} aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default VaultBoot;
