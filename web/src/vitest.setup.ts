import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Register cleanup explicitly so tests do not share DOM state between runs.
afterEach(() => {
  cleanup();
});
