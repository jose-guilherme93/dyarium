import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VaultBoot } from "./VaultBoot";

function meter(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".vault-boot-meter");
  if (!(el instanceof HTMLElement)) throw new Error("medidor fora da tela");
  return el;
}

function detail(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".vault-boot-detail");
  if (!(el instanceof HTMLElement)) throw new Error("linha da etapa fora da tela");
  return el;
}

describe("VaultBoot", () => {
  it("diz o que esta fazendo em cada etapa", () => {
    const { container, rerender } = render(<VaultBoot stage="conectando" />);
    expect(detail(container)).toHaveTextContent("entrando com o Google");
    // O titulo e o mesmo do carregamento de nota.
    expect(screen.getByText("Carregando…")).toBeInTheDocument();

    rerender(<VaultBoot stage="lendo" />);
    expect(detail(container)).toHaveTextContent("lendo o cofre");

    rerender(<VaultBoot stage="decifrando" />);
    expect(detail(container)).toHaveTextContent("abrindo o retrato");

    rerender(<VaultBoot stage="sincronizando" />);
    expect(detail(container)).toHaveTextContent("gravando o que mudou");
  });

  it("conta as notas que estao entrando", () => {
    const { container } = render(
      <VaultBoot stage="aplicando" progress={{ done: 338, total: 400 }} />,
    );
    // O numero que conta em 600 e o total no mesmo texto, so discreto.
    expect(screen.getByText("338")).toBeInTheDocument();
    expect(detail(container)).toHaveTextContent("338 de 400 notas");
  });

  it("conta os anexos que estao voltando", () => {
    const { container } = render(
      <VaultBoot stage="anexos" progress={{ done: 178, total: 218 }} />,
    );
    expect(detail(container)).toHaveTextContent("178 de 218 anexos");
  });

  it("esconde o medidor quando a etapa nao tem contagem", () => {
    const { container } = render(<VaultBoot stage="lendo" />);
    expect(meter(container)).toHaveAttribute("data-idle", "true");
    expect(meter(container).querySelector("span")).toHaveStyle({ width: "0%" });
  });

  it("mostra o medidor cheio na medida da contagem", () => {
    const { container } = render(
      <VaultBoot stage="aplicando" progress={{ done: 338, total: 400 }} />,
    );
    expect(meter(container)).toHaveAttribute("data-idle", "false");
    expect(meter(container).querySelector("span")).toHaveStyle({ width: "84.5%" });
  });

  it("termina em pronto, com o disco no lugar do circulo", () => {
    const { container } = render(
      <VaultBoot stage="anexos" progress={{ done: 218, total: 218 }} done />,
    );
    expect(screen.getByText("pronto")).toBeInTheDocument();
    expect(container.querySelector(".vault-boot-glyph")).toHaveClass("is-done");
    // Sem trabalho pendente: a area deixa de estar ocupada.
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "false");
    expect(meter(container)).toHaveAttribute("data-idle", "true");
  });

  it("anuncia so a etapa, nunca o titulo", () => {
    const { container } = render(<VaultBoot stage="lendo" />);
    const aoVivo = container.querySelectorAll('[aria-live="polite"]');
    expect(aoVivo).toHaveLength(1);
    expect(aoVivo[0]).toHaveTextContent("lendo o cofre");
    expect(screen.getByText("Carregando…").closest("[aria-live]")).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
  });
});
