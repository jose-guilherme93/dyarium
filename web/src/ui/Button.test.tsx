import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("aplica as classes de variante e tamanho pedidas", () => {
    render(
      <Button variant="secondary" size="sm">
        editar
      </Button>,
    );

    const botao = screen.getByRole("button", { name: "editar" });
    expect(botao).toHaveClass("dy-btn");
    expect(botao).toHaveClass("dy-btn--secondary");
    expect(botao).toHaveClass("dy-btn--sm");
  });

  it("desabilitado nao dispara onClick", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        salvar
      </Button>,
    );

    const botao = screen.getByRole("button", { name: "salvar" });
    expect(botao).toBeDisabled();

    fireEvent.click(botao);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("leva type=submit ao DOM", () => {
    render(<Button type="submit">salvar</Button>);

    expect(screen.getByRole("button", { name: "salvar" })).toHaveAttribute("type", "submit");
  });
});
