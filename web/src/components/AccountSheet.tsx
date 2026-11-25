import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cachedSummary, tamanho } from "./DriveReconnect";
import { flushVaultSync, lastSyncSummary } from "../local/folderSync";
import { connectDrive, driveSessionState, signOutAccount } from "../local/driveSession";
import type { GoogleProfile } from "../local/account";
import { formatRelativeTime } from "../lib/format";
import { useEscape } from "../lib/useEscape";
import { Icon } from "../ui";
import { ExitIcon, ExternalIcon, UserIcon } from "./icons";

/** Estado da conta neste navegador; a forma da marca distingue antes da cor. */
export type AccountState = "connected" | "expired" | "none";

export function accountState(profile: GoogleProfile | null): AccountState {
  if (!profile) return "none";
  if (driveSessionState() === "connected") return "connected";
  // Ha conta neste navegador, mas a sessao do Google caiu: anel de aviso.
  return "expired";
}

function iniciais(profile: GoogleProfile | null): string {
  const base = (profile?.name?.trim() || profile?.email?.trim() || "").trim();
  if (!base) return "";
  const partes = base.split(/\s+/).filter(Boolean);
  const letras = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : base.slice(0, 2);
  return letras.toUpperCase();
}

/**
 * Avatar da conta no tamanho do sistema: 26, raio 3, com a marca de estado de
 * 8 no canto. Sem conta o desenho e a pessoa do conjunto, nao um "?" que
 * pareceria ajuda. O botao que o envolve e de quem abre o menu.
 */
export function AccountAvatar({
  profile,
  state,
}: {
  profile: GoogleProfile | null;
  state: AccountState;
}) {
  const letras = iniciais(profile);
  return (
    <>
      {profile?.picture ? (
        <img
          src={profile.picture}
          alt=""
          className="account-avatar-img"
          referrerPolicy="no-referrer"
        />
      ) : letras ? (
        <span className="account-avatar-initials dy-label" aria-hidden="true">
          {letras}
        </span>
      ) : (
        <span className="account-avatar-glyph" aria-hidden="true">
          <UserIcon size={13} />
        </span>
      )}
      <span className={`account-state-mark account-state-mark--${state}`} aria-hidden="true" />
    </>
  );
}

interface AccountSheetProps {
  open: boolean;
  onClose: () => void;
  profile: GoogleProfile | null;
  /** Botao que abriu o menu: ancora a posicao, fica fora do clique-fora e
   *  recebe o foco de volta ao fechar. */
  anchor?: HTMLElement | null;
  onSync?: () => void | Promise<void>;
}

const LARGURA = 238;
const ALTURA_BARRA = 34;

interface Posicao {
  left: number;
  width: number;
  /** Um dos dois: o menu sobe acima do gatilho ou desce abaixo dele. */
  top?: number;
  bottom?: number;
}

function posicionar(anchor: HTMLElement | null | undefined): Posicao {
  const width = Math.max(180, Math.min(LARGURA, window.innerWidth - 16));
  const rect = anchor?.getBoundingClientRect();
  if (!rect) {
    return { left: ALTURA_BARRA, width, bottom: 8 };
  }
  // O avatar do trilho encosta na borda esquerda: o menu nasce com a largura
  // inteira do trilho de recuo. Em outros gatilhos (a barra do celular) ele
  // encosta no que couber, sem sair da janela.
  const noTrilho = rect.right <= 40;
  const left = noTrilho
    ? ALTURA_BARRA
    : Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  // No pe do trilho o menu sobe; na barra do celular, que fica no topo, ele
  // desce a partir da barra (e nao de dentro dela). O lado escolhido nunca sai
  // da janela.
  const acima = rect.top > window.innerHeight / 2;
  const barraTopo = anchor?.closest?.(".mobile-bar") as HTMLElement | null;
  const abaixoDe = barraTopo ? barraTopo.getBoundingClientRect().bottom : rect.bottom;
  const top = Math.max(8, Math.min(abaixoDe + 6, window.innerHeight - 8));
  const bottom = Math.max(8, Math.min(window.innerHeight - 8, window.innerHeight - rect.top + 6));
  return acima ? { left, width, bottom } : { left, width, top };
}

/**
 * Conta Google: menu ancorado no avatar, sem veu e sem caixa central.
 *
 * Mostra quem esta conectado, o tamanho do cofre, o ultimo envio e as duas
 * acoes deste navegador — sincronizar e sair. Nome e foto sao da conta Google;
 * o link no pe leva ao unico lugar onde eles mudam. Nada aqui explica o que a
 * tela ja mostra.
 */
export function AccountSheet({ open, onClose, profile, anchor, onSync }: AccountSheetProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Posicao>({ left: ALTURA_BARRA, width: LARGURA, bottom: 8 });
  const estado = accountState(profile);
  const conectado = estado === "connected";
  const resumo = cachedSummary();
  const ultimo = lastSyncSummary();

  useLayoutEffect(() => {
    setPos(posicionar(anchor));
  }, [anchor, open]);

  useEscape(open, onClose);

  // Clique fora fecha; o gatilho fica de fora da regra para o proprio clique
  // poder alternar o menu sem fechar e reabrir no mesmo gesto.
  useEffect(() => {
    if (!open) return undefined;
    const fora = (event: MouseEvent) => {
      const alvo = event.target as Node | null;
      if (!alvo) return;
      if (menuRef.current?.contains(alvo)) return;
      if (anchor?.contains(alvo)) return;
      onClose();
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [open, anchor, onClose]);

  // O foco entra no menu e volta ao gatilho quando ele fecha.
  useEffect(() => {
    if (!open) return undefined;
    const anterior = anchor ?? (document.activeElement as HTMLElement | null);
    const primeiro = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    primeiro?.focus();
    return () => {
      anterior?.focus?.();
    };
  }, [open, anchor]);

  if (!open) return null;

  const resumoTexto =
    estado === "none" ? "— notas" : resumo ? tamanho(resumo) : "sessão vencida";
  const acao = estado === "none" ? "Conectar Google" : conectado ? "Sincronizar" : "Conectar";

  const sincronizar = () => {
    onClose();
    void (async () => {
      try {
        if (!conectado) await connectDrive();
        await flushVaultSync();
      } catch {
        // A linha de reconectar na area das notas continua sendo o aviso.
      }
      try {
        await onSync?.();
      } catch {
        // Atualizar a tela e enfeite; o cofre ja foi gravado.
      }
    })();
  };

  const sair = () => {
    signOutAccount();
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="account-menu"
      role="menu"
      aria-label="Conta Google"
      style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const itens = Array.from(
          menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
        );
        if (itens.length === 0) return;
        event.preventDefault();
        const atual = itens.indexOf(document.activeElement as HTMLElement);
        const passo = event.key === "ArrowDown" ? 1 : -1;
        const proximo = (atual + passo + itens.length) % itens.length;
        itens[proximo].focus();
      }}
    >
      <div className="account-menu-id">
        {profile?.picture ? (
          <img
            className="account-menu-photo"
            src={profile.picture}
            alt=""
            width={40}
            height={40}
            referrerPolicy="no-referrer"
          />
        ) : estado === "none" || !iniciais(profile) ? (
          <span className="account-menu-photo account-menu-photo--empty" aria-hidden="true">
            <UserIcon size={18} />
          </span>
        ) : (
          <span className="account-menu-photo account-menu-photo--initials" aria-hidden="true">
            {iniciais(profile)}
          </span>
        )}
        <span className="account-menu-idtext">
          <span className="account-menu-name dy-body">
            {profile?.name || profile?.email || "Sem conta"}
          </span>
          <span className="account-menu-mail dy-mono">{profile?.email || "—"}</span>
        </span>
      </div>

      <div className="account-menu-sep" aria-hidden="true" />
      <div className="account-menu-data">
        <div className="account-menu-data-row">
          <span className="account-menu-label dy-body">Google Drive</span>
          <span className={`account-state-mark account-state-mark--${estado}`} aria-hidden="true" />
          <span className="account-menu-val dy-mono">{resumoTexto}</span>
        </div>
        <div className="account-menu-data-row">
          <span className="account-menu-label dy-body">Último envio</span>
          <span className="account-menu-val dy-mono">
            {ultimo?.at ? formatRelativeTime(ultimo.at) : "—"}
          </span>
        </div>
      </div>
      <div className="account-menu-sep" aria-hidden="true" />

      <button
        type="button"
        role="menuitem"
        className="account-menu-row dy-body"
        onClick={sincronizar}
      >
        <Icon name={estado === "none" ? "cloud" : "sync"} size={12} />
        <span>{acao}</span>
      </button>

      {estado !== "none" && (
        <>
          <div className="account-menu-sep" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            className="account-menu-row account-menu-row--danger dy-body"
            onClick={sair}
          >
            <span className="account-menu-glyph" aria-hidden="true">
              <ExitIcon size={12} />
            </span>
            <span>Sair</span>
          </button>
        </>
      )}

      {profile && (
        <>
          <div className="account-menu-sep" aria-hidden="true" />
          <a
            className="account-menu-footlink dy-mono"
            href="https://myaccount.google.com"
            target="_blank"
            rel="noreferrer"
          >
            <span className="account-menu-glyph" aria-hidden="true">
              <UserIcon size={12} />
            </span>
            <span>foto e nome no Google</span>
            <span className="account-menu-glyph account-menu-glyph--end" aria-hidden="true">
              <ExternalIcon size={12} />
            </span>
          </a>
        </>
      )}
    </div>,
    document.body,
  );
}

export default AccountSheet;
