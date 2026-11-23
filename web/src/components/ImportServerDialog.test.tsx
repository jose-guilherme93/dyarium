import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportServerDialog } from "./ImportServerDialog";

const mocks = vi.hoisted(() => ({ startServerImport: vi.fn() }));

vi.mock("../local/importJob", () => ({ startServerImport: mocks.startServerImport }));

beforeEach(() => {
  mocks.startServerImport.mockReset();
});

describe("ImportServerDialog", () => {
  it("entrega endereco e token e fecha na hora, sem esperar a importacao", () => {
    const ordem: string[] = [];
    mocks.startServerImport.mockImplementation((endereco: string, token: string) => {
      ordem.push(`inicio ${endereco} ${token}`);
    });

    render(<ImportServerDialog onClose={() => ordem.push("fechou")} />);
    fireEvent.change(screen.getByLabelText("Endereço"), {
      target: { value: "https://diario.exemplo" },
    });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "segredo" } });
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));

    expect(mocks.startServerImport).toHaveBeenCalledWith("https://diario.exemplo", "segredo");
    // Primeiro inicia, depois fecha: nao ha promessa para o dialogo aguardar.
    expect(ordem).toEqual(["inicio https://diario.exemplo segredo", "fechou"]);
    // Nada de progresso interno: quem conta a importacao e a faixa.
    expect(screen.queryByText(/Importando/)).not.toBeInTheDocument();
    expect(screen.queryByText(/de 419/)).not.toBeInTheDocument();
  });

  it("sem endereco ou sem token nao inicia nada", () => {
    const fechou = vi.fn();
    render(<ImportServerDialog onClose={fechou} />);

    const importar = screen.getByRole("button", { name: "Importar" });
    expect(importar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Endereço"), {
      target: { value: "https://diario.exemplo" },
    });
    expect(importar).toBeDisabled();
    fireEvent.click(importar);
    expect(mocks.startServerImport).not.toHaveBeenCalled();
    expect(fechou).not.toHaveBeenCalled();
  });
});
