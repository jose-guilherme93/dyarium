/**
 * Pulso anonimo de uso que alimenta o /admin.
 *
 * Anonimo: sem conteudo de nota, sem texto. O install id identifica a
 * instalacao, nao a pessoa. O e-mail so vai no evento "connect" (login), para
 * o painel do dono; o "boot" nunca leva e-mail.
 */

const INSTALL_KEY = "dyarium.install";
const PULSE_KEY = "dyarium.pulse";

import { adminApiUrl } from "./apiBase";

interface PulseRecord {
  boot?: string;
  connect?: string;
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readPulseRecord(): PulseRecord {
  try {
    const raw = localStorage.getItem(PULSE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PulseRecord;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writePulseRecord(record: PulseRecord): void {
  try {
    localStorage.setItem(PULSE_KEY, JSON.stringify(record));
  } catch {
    // Sem storage: a deduplicacao vale so para esta chamada.
  }
}

let memoryInstallId: string | null = null;

function generateInstallId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function installId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_KEY);
    if (existing) return existing;
    const created = generateInstallId();
    try {
      localStorage.setItem(INSTALL_KEY, created);
      return created;
    } catch {
      // Storage falhou ao gravar: cai no id em memoria.
    }
  } catch {
    // Storage falhou ao ler: cai no id em memoria.
  }
  if (!memoryInstallId) memoryInstallId = generateInstallId();
  return memoryInstallId;
}

function pulseEnabled(): boolean {
  try {
    return Boolean(import.meta.env.PROD) || import.meta.env.VITE_PULSE === "1";
  } catch {
    return false;
  }
}

export function pulseBoot(counts?: {
  notes?: number;
  bytes?: number;
  has_drive?: boolean;
}): void {
  if (!pulseEnabled()) return;
  try {
    const record = readPulseRecord();
    const today = todayLocal();
    if (record.boot === today) return;
    record.boot = today;
    writePulseRecord(record);

    const payload: Record<string, unknown> = {
      install: installId(),
      event: "boot",
      version: __APP_VERSION__,
      platform: "web",
    };
    if (typeof counts?.notes === "number") payload.notes = counts.notes;
    if (typeof counts?.bytes === "number") payload.bytes = counts.bytes;
    if (typeof counts?.has_drive === "boolean") payload.has_drive = counts.has_drive;

    fetch(adminApiUrl("/pulse"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Nunca lancar: o pulso e best-effort.
  }
}

export function pulseConnect(email?: string): void {
  if (!pulseEnabled()) return;
  try {
    const record = readPulseRecord();
    const today = todayLocal();
    if (record.connect === today) return;
    record.connect = today;
    writePulseRecord(record);

    const trimmed = (email ?? "").trim();
    const payload: Record<string, unknown> = {
      install: installId(),
      event: "connect",
      version: __APP_VERSION__,
      platform: "web",
    };
    if (trimmed) payload.email = trimmed;

    fetch(adminApiUrl("/pulse"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Nunca lancar: o pulso e best-effort.
  }
}
