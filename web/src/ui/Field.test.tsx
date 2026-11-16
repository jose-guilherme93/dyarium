import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Field } from "./Field";

describe("Field", () => {
  it("associa o rotulo ao input e devolve o texto digitado", () => {
    const onChange = vi.fn();
    render(<Field label="nota" value="" onChange={onChange} />);

    const input = screen.getByLabelText("nota");
    expect(input).toHaveClass("dy-field__input");

    fireEvent.change(input, { target: { value: "Consulta" } });
    expect(onChange).toHaveBeenCalledWith("Consulta");
  });

  it("usa o id informado no htmlFor e no input", () => {
    render(<Field id="campo-nota" label="nota" value="" onChange={() => undefined} />);

    const input = screen.getByLabelText("nota");
    expect(input).toHaveAttribute("id", "campo-nota");
  });
});
