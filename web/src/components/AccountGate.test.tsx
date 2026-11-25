import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AccountGate } from "./AccountGate";

const PERFIL = { name: "Ada Lovelace", email: "ada@example.com", picture: "" };

function trava(extra: Partial<Parameters<typeof AccountGate>[0]> = {}) {
  return render(
    <AccountGate
      profile={PERFIL}
      configured
      onFirstTouch={() => undefined}
      onConnect={() => undefined}
      onSignOut={() => undefined}
      {...extra}
    />,
  );
}

describe("AccountGate (tela travada da conta)", () => {
  it("mostra a foto cacheada quando existe", () => {
    trava({ profile: { ...PERFIL, picture: "https://exemplo/foto.png" } });

    const foto = document.querySelector(".account-gate-photo img") as HTMLImageElement;
    expect(foto.tagName).toBe("IMG");
    expect(foto.getAttribute("src")).toBe("https://exemplo/foto.png");
    expect(foto.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(document.querySelector(".account-gate-initials")).toBeNull();
  });

  it("sem foto cai nas iniciais do perfil", () => {
    trava();

    expect(document.querySelector(".account-gate-initials")?.textContent).toBe("AL");
    expect(document.querySelector(".account-gate-photo img")).toBeNull();
  });

  it("sem perfil mostra a pessoa, sem inventar nome", () => {
    trava({ profile: null });

    expect(document.querySelector(".account-gate-person")).not.toBeNull();
    expect(document.querySelector(".account-gate-initials")).toBeNull();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Entrar com Google" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sair desta conta" }),
    ).toBeInTheDocument();
  });

  it("Entrar chama o caminho interativo e Sair chama a saída", () => {
    const onConnect = vi.fn();
    const onSignOut = vi.fn();
    const onFirstTouch = vi.fn();
    trava({ onConnect, onSignOut, onFirstTouch });

    const entrar = screen.getByRole("button", { name: "Entrar com Google" });
    fireEvent.pointerDown(entrar);
    fireEvent.click(entrar);
    expect(onConnect).toHaveBeenCalledTimes(1);
    // O toque no controle nao dispara a tentativa silenciosa do fundo.
    expect(onFirstTouch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sair desta conta" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("sem client id o Entrar fica desligado", () => {
    trava({ configured: false });

    expect(screen.getByRole("button", { name: "Entrar com Google" })).toBeDisabled();
  });

  it("o primeiro toque no fundo pede a sessão em silêncio, uma vez", () => {
    const onFirstTouch = vi.fn();
    trava({ onFirstTouch });

    fireEvent.pointerDown(screen.getByRole("main", { name: "Conta Google" }));
    fireEvent.pointerDown(screen.getByRole("main", { name: "Conta Google" }));

    expect(onFirstTouch).toHaveBeenCalledTimes(1);
  });

  it("erro acionável fica em uma linha de alerta", () => {
    trava({ error: "A janela do Google não abriu. Tente de novo." });

    expect(screen.getByRole("alert")).toHaveTextContent("A janela do Google não abriu");
  });
});
