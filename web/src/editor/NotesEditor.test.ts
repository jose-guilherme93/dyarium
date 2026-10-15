import { describe, expect, it } from "vitest";

// Importing the module builds the BlockNote schema (custom audio/image blocks);
// a broken schema would throw here.
describe("NotesEditor module", () => {
  it("constroi o schema com os blocos de midia", async () => {
    const mod = await import("./NotesEditor");
    expect(mod.NotesEditor).toBeTruthy();
    expect(mod.mediaRefs).toBeTypeOf("function");
  });
});
