import { describe, expect, it } from "vitest";
import { patchNoteViewState, readNoteViewState, rememberAudioTime } from "./noteViewState";

describe("noteViewState", () => {
  it("nao compartilha o estado vazio entre notas", () => {
    rememberAudioTime("nota-a", "audio-1", 3);
    expect(readNoteViewState("nota-b").audioTimes).toEqual({});

    const state = readNoteViewState("nota-b");
    state.scrollTop = 120;
    expect(readNoteViewState("nota-c").scrollTop).toBe(0);
    expect(readNoteViewState("nota-b").scrollTop).toBe(0);
  });

  it("guarda o patch e a posicao por audio", () => {
    patchNoteViewState("nota-a", { asideOpen: true, scrollTop: 40 });
    rememberAudioTime("nota-a", "audio-1", 12.5);

    expect(readNoteViewState("nota-a")).toMatchObject({
      asideOpen: true,
      scrollTop: 40,
      audioTimes: { "audio-1": 12.5 },
    });
  });
});
