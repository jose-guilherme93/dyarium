import { useRef, useState } from "react";
import { Button } from "../ui";
import type { GoogleProfile } from "../local/account";
import { accountInitials } from "./AccountSheet";
import { BRAND, brandClass } from "../lib/brand";
import { ExitIcon, UserIcon } from "./icons";
import "./AccountGate.css";

export interface AccountGateProps {
  /** Perfil cacheado da conta Google: so exibicao. */
  profile: GoogleProfile | null;
  /** Ha client id para o login? Sem ele, o botao do Google fica desligado. */
  configured: boolean;
  /** Erro acionavel do caminho interativo; o silencioso nunca escreve aqui. */
  error?: string;
  /** Primeiro toque no fundo: o App tenta a sessao sem tela. */
  onFirstTouch: () => void;
  /** Caminho interativo, com a janela do Google. */
  onConnect: () => void;
  /** Fluxo de saida existente: grava, confere e apaga o cache. */
  onSignOut: () => void;
}

/**
 * Tela travada da conta.
 *
 * O navegador guarda a marca do Drive e o perfil, nunca a credencial. Quando o
 * token nao sobrevive ao reload, esta tela aparece no lugar do cofre: mostra
 * quem e a conta pelo que esta em cache e oferece voltar ou sair. O primeiro
 * toque no fundo tenta o Google em silencio; a tela nao explica o que o usuario
 * ja ve, e o unico texto e identidade, rotulo de acao e erro acionavel.
 */
export function AccountGate({
  profile,
  configured,
  error = "",
  onFirstTouch,
  onConnect,
  onSignOut,
}: AccountGateProps) {
  const [quebrada, setQuebrada] = useState<string | null>(null);
  const tentou = useRef(false);
  const foto = profile?.picture?.trim() ?? "";
  const mostrarFoto = foto.length > 0 && quebrada !== foto;
  const letras = accountInitials(profile);
  const nome = profile?.name?.trim() ?? "";
  const email = profile?.email?.trim() ?? "";
  const titulo = nome || email;

  return (
    <main
      className="account-gate dy-body"
      aria-label="Conta Google"
      onPointerDown={(event) => {
        if (event.button !== 0 || tentou.current) return;
        const alvo = event.target as Element | null;
        // O toque num controle e do controle: Entrar e Sair tem caminho proprio.
        if (alvo?.closest("button, a, input, textarea, select")) return;
        tentou.current = true;
        onFirstTouch();
      }}
    >
      <header className="account-gate-top">
        <h1 className={brandClass("account-gate-brand dy-title")}>{BRAND.name}</h1>
        <span className="account-gate-brand-note dy-label">tinta e papel</span>
      </header>

      <div className="account-gate-body">
        <div className="account-gate-block">
          <span className="account-gate-kicker dy-label">Conta Google</span>

          <div className="account-gate-id">
            <span className="account-gate-photo">
              {mostrarFoto ? (
                <img
                  src={foto}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setQuebrada(foto)}
                />
              ) : letras ? (
                <span className="account-gate-initials dy-display" aria-hidden="true">
                  {letras}
                </span>
              ) : (
                <span className="account-gate-person" aria-hidden="true">
                  <UserIcon size={24} />
                </span>
              )}
              <span
                className={`account-state-mark account-state-mark--${profile ? "expired" : "none"}`}
                aria-hidden="true"
              />
            </span>

            {titulo && (
              <span className="account-gate-idtext">
                <span className="account-gate-name dy-display">{titulo}</span>
                {nome && email && <span className="account-gate-mail dy-mono">{email}</span>}
              </span>
            )}
          </div>

          <div className="account-gate-rule" aria-hidden="true" />

          <div className="account-gate-actions">
            <Button
              variant="primary"
              size="lg"
              disabled={!configured}
              onClick={onConnect}
            >
              Entrar com Google
            </Button>
            <button
              type="button"
              className="account-gate-signout dy-label"
              onClick={onSignOut}
            >
              <span className="account-gate-glyph" aria-hidden="true">
                <ExitIcon size={12} />
              </span>
              <span>Sair desta conta</span>
            </button>
          </div>

          {error && (
            <p className="account-gate-error dy-mono" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export default AccountGate;
