import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PrivacyView } from "./PrivacyView";

describe("PrivacyView", () => {
  it("diz que o e-mail identifica a sessao e nao revela o painel do dono", () => {
    render(<PrivacyView />);

    expect(screen.getByRole("heading", { name: "Privacidade" })).toBeInTheDocument();
    expect(screen.getByText("O que não coletamos")).toBeInTheDocument();
    expect(screen.getByText("Conta Google")).toBeInTheDocument();
    expect(screen.getByText(/o e-mail da conta identifica a sua sessão/i)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum endereço IP é guardado/)).toBeInTheDocument();

    // Administracao nao e assunto do usuario: nada de /admin nem painel.
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/admin/i);
    expect(texto).not.toMatch(/painel/i);
  });
});
