/**
 * Identidade do dispositivo que processou a analise no navegador.
 *
 * O navegador nao expoe o hostname da maquina. O que da para guardar e um
 * identificador anonimo e estavel desta instalacao (localStorage) mais um rotulo
 * curto do que ela e: navegador, sistema e placa. Serve para o painel mostrar
 * "neste PC" com o nome do computador e para separar uma analise local de uma
 * chamada de API — nunca para decidir quem processa.
 */

import type { HardwareSnapshot } from "./hardware";

const DEVICE_KEY = "dyarium.device";

export interface DeviceIdentity {
  /** Anonimo e estavel: identifica a instalacao, nao a pessoa. */
  id: string;
  /** Rotulo curto: "Edge 156 · Windows · Intel HD Graphics 620". */
  name: string;
}

function randomId(): string {
  const source = globalThis.crypto;
  const bytes = new Uint8Array(12);
  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `dev-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Le ou cria o identificador da instalacao. */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = randomId();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    // sem localStorage: o id vale so para esta aba
    return randomId();
  }
}

/**
 * Nome legivel da placa a partir do que o navegador entrega. O WebGL costuma
 * devolver "ANGLE (Intel, Mesa Intel(R) HD Graphics 620 (KBL GT2), OpenGL ES
 * 3.2)"; o aparelho na analise e "Intel HD Graphics 620".
 */
export function gpuLabelFor(snapshot: HardwareSnapshot): string {
  const adapter = snapshot.webgpu.adapter;
  const source =
    adapter?.description || adapter?.device || adapter?.architecture || snapshot.webgl.renderer || "";
  if (!source) return "";
  const inner = /ANGLE \((.*)\)/i.exec(source)?.[1] ?? source;
  const parts = inner
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // "ANGLE (Intel, Mesa Intel(R) HD Graphics 620 (KBL GT2), OpenGL ES 3.2)"
  // tem o fabricante solto na primeira parte; a placa inteira e a maior.
  const named = parts.filter((part) =>
    /(graphics|geforce|radeon|arc|iris|adreno|mali|apple|nvidia|intel|amd)/i.test(part),
  );
  const card = (named.length > 0 ? named : parts).sort((a, b) => b.length - a.length)[0] ?? "";
  return card
    .replace(/^mesa\s+/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*\((r|tm|c)\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function platformLabel(snapshot: HardwareSnapshot): string {
  const raw = (snapshot.platform ?? "").trim();
  if (!raw) return "";
  const known: Record<string, string> = {
    windows: "Windows",
    macos: "macOS",
    "mac os x": "macOS",
    linux: "Linux",
    android: "Android",
    ios: "iOS",
    "chrome os": "ChromeOS",
    chromeos: "ChromeOS",
  };
  return known[raw.toLowerCase()] ?? raw;
}

/** Monta a identidade a partir do retrato do hardware ja detectado. */
export function loadDeviceIdentity(snapshot: HardwareSnapshot): DeviceIdentity {
  const browser = snapshot.browser;
  const browserLabel = `${browser.name}${browser.version ? ` ${browser.version.split(".")[0]}` : ""}`;
  const name = [browserLabel, platformLabel(snapshot), gpuLabelFor(snapshot)]
    .filter(Boolean)
    .join(" · ");
  return { id: deviceId(), name: name || "navegador" };
}
