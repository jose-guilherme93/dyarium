import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PrivacyView } from "./PrivacyView";

describe("PrivacyView", () => {
  it("fala do que nao sai do aparelho e nao revela o painel do dono", () => {
    render(<PrivacyView />);

    expect(screen.getByRole("heading", { name: "Privacidade" })).toBeInTheDocument();
    expect(screen.getByText("O que não coletamos")).toBeInTheDocument();
    expect(screen.getByText(/Nenhum endereço IP é guardado/)).toBeInTheDocument();

    // Administracao nao e assunto do usuario: nada de /admin, painel ou e-mail.
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/admin/i);
    expect(texto).not.toMatch(/painel/i);
    expect(texto).not.toMatch(/e-mail/i);
  });
});
