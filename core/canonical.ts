import { createHash, randomUUID } from "node:crypto";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const next = input[key];
      if (next !== undefined) out[key] = sortValue(next);
    }
    return out;
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function randomId(prefix = ""): string {
  return `${prefix}${randomUUID()}`;
}

export function pairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function shortHash(value: string): string {
  return value.slice(0, 10);
}

export function localDate(iso = new Date().toISOString()): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isoAtLocalTime(date: string, hours: number, minutes: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return d.toISOString();
}

export function daysAgo(count: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - count);
  return localDate(d.toISOString());
}

export function formatKes(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents) / 100;
  return `${sign}KSh ${value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseMoneyToCents(value: string | number): number {
  if (typeof value === "number") return Math.round(value * 100);
  const clean = value.replace(/[^0-9.-]/g, "");
  return Math.round(Number(clean) * 100);
}
