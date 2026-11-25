import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// A interface fala com o servidor por padrao nos testes: e o caminho que os
// componentes ja exercitam com `fetch` dublado. O cofre local tem testes
// proprios em `src/local` e no primeiro teste do `App`.
localStorage.setItem("dyarium.token", "token-de-teste");

// Register cleanup explicitly so tests do not share DOM state between runs.
afterEach(() => {
  cleanup();
});
