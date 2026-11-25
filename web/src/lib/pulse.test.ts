import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installId, pulseBoot, pulseConnect } from "./pulse";

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pulse", () => {
  it("nada sem PROD/VITE_PULSE", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    pulseBoot();
    pulseConnect("a@b.com");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("boot sem email", () => {
    vi.stubEnv("VITE_PULSE", "1");
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    pulseBoot({ notes: 3, bytes: 10, has_drive: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/pulse");
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("boot");
    expect(body.email).toBeUndefined();
    expect(body.notes).toBe(3);
    expect(body.bytes).toBe(10);
    expect(body.has_drive).toBe(true);
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("connect com email", () => {
    vi.stubEnv("VITE_PULSE", "1");
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    pulseConnect("  a@b.com  ");
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.event).toBe("connect");
    expect(body.email).toBe("a@b.com");
  });

  it("email vazio omitido", () => {
    vi.stubEnv("VITE_PULSE", "1");
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    pulseConnect("   ");
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.email).toBeUndefined();
  });

  it("dedupe mesmo dia", () => {
    vi.stubEnv("VITE_PULSE", "1");
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    pulseBoot();
    pulseBoot();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("novo dia envia de novo", () => {
    vi.stubEnv("VITE_PULSE", "1");
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    pulseBoot();
    localStorage.setItem("dyarium.pulse", JSON.stringify({ boot: "2000-01-01" }));
    pulseBoot();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("install id estavel", () => {
    const a = installId();
    const b = installId();
    expect(a).toBe(b);
  });

  it("fetch rejeitando nao quebra", () => {
    vi.stubEnv("VITE_PULSE", "1");
    const fetchSpy = vi.fn(async () => {
      throw new Error("fail");
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(() => pulseBoot()).not.toThrow();
  });

  it("payload sem campos extras", () => {
    vi.stubEnv("VITE_PULSE", "1");
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    pulseBoot();
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(body).sort()).toEqual(["event", "install", "platform", "version"]);
  });
});
