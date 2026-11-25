import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheProfile,
  cachedProfile,
  clearAccountCache,
  fetchProfile,
  onAccountChange,
} from "./account";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account cache", () => {
  it("round-trip", () => {
    cacheProfile({ name: "Ada", email: "ada@example.com", picture: "https://x/p.png" });
    expect(cachedProfile()).toEqual({
      name: "Ada",
      email: "ada@example.com",
      picture: "https://x/p.png",
    });
  });

  it("malformed cache ignored", () => {
    localStorage.setItem("dyarium.account", "{not json");
    expect(cachedProfile()).toBeNull();
    localStorage.setItem("dyarium.account", JSON.stringify({ name: "Ada" }));
    expect(cachedProfile()).toBeNull();
  });

  it("clearAccountCache clears", () => {
    cacheProfile({ name: "Ada", email: "ada@example.com", picture: "" });
    clearAccountCache();
    expect(cachedProfile()).toBeNull();
  });
});

describe("fetchProfile", () => {
  it("success returns and caches", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: "Ada", email: "ada@example.com", picture: "https://x/p.png" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchProfile("tok");
    expect(result).toEqual({ name: "Ada", email: "ada@example.com", picture: "https://x/p.png" });
    expect(cachedProfile()).toEqual(result);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("failure returns null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchProfile("tok")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("boom");
    }));
    expect(await fetchProfile("tok")).toBeNull();
  });
});

describe("onAccountChange", () => {
  it("notifies", () => {
    const cb = vi.fn();
    const off = onAccountChange(cb);
    cacheProfile({ name: "Ada", email: "a@b.com", picture: "" });
    expect(cb).toHaveBeenCalledWith({ name: "Ada", email: "a@b.com", picture: "" });
    off();
    clearAccountCache();
    // after unsubscribe, not called again
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("signOut through the session", () => {
  it("limpa cache e marca do Drive", async () => {
    const { signOutAccount } = await import("./driveSession");
    localStorage.setItem("dyarium.drive", "1");
    cacheProfile({ name: "Ada", email: "a@b.com", picture: "" });
    const resultado = await signOutAccount();
    expect(resultado).toEqual({ ok: true });
    expect(cachedProfile()).toBeNull();
    expect(localStorage.getItem("dyarium.drive")).toBeNull();
  });
});