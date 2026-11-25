import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateMark } from "./StateMark";

describe("StateMark", () => {
  it("feito usa disco preenchido", () => {
    render(<StateMark state="done" />);
    const mark = screen.getByRole("img", { name: "feito" });
    expect(mark).toHaveAttribute("data-state", "done");
  });

  it("nao feito usa anel vazio", () => {
    render(<StateMark state="todo" />);
    expect(screen.getByRole("img", { name: "não feito" })).toHaveAttribute(
      "data-state",
      "todo",
    );
  });

  it("ficou de fora usa anel com traco", () => {
    render(<StateMark state="out" />);
    expect(screen.getByRole("img", { name: "ficou de fora" })).toHaveAttribute(
      "data-state",
      "out",
    );
  });

  it("aceita rotulo proprio", () => {
    render(<StateMark state="done" label="enviada" />);
    expect(screen.getByRole("img", { name: "enviada" })).toBeInTheDocument();
  });
});
