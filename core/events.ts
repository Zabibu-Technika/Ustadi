import type { EventType, LedgerEvent } from "./types.ts";
import { canonicalJson, sha256Hex } from "./canonical.ts";

export const GENESIS_HASH = "0".repeat(64);

export interface CreateEventInput {
  deviceId: string;
  seq: number;
  lamport: number;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt?: string;
  idempotencyKey?: string;
  prevHash?: string;
}

export function eventHash(event: Omit<LedgerEvent, "hash">): string {
  return sha256Hex(canonicalJson(event));
}

export function createEvent(input: CreateEventInput): LedgerEvent {
  const base: Omit<LedgerEvent, "hash"> = {
    id: `${input.deviceId}-${input.seq}-${Date.now().toString(36)}`,
    deviceId: input.deviceId,
    seq: input.seq,
    lamport: input.lamport,
    type: input.type,
    payload: input.payload,
    createdAt: input.createdAt ?? new Date().toISOString(),
    idempotencyKey: input.idempotencyKey ?? `${input.deviceId}:${input.seq}`,
    prevHash: input.prevHash ?? GENESIS_HASH
  };
  return { ...base, hash: eventHash(base) };
}

export interface EventValidation {
  ok: boolean;
  reason?: string;
}

export function verifyEvent(event: LedgerEvent): EventValidation {
  if (!event || typeof event !== "object") return { ok: false, reason: "event is not an object" };
  if (!event.id || !event.deviceId || !event.type) return { ok: false, reason: "missing identity fields" };
  if (!Number.isInteger(event.seq) || event.seq < 1) return { ok: false, reason: "invalid seq" };
  if (!Number.isInteger(event.lamport) || event.lamport < 0) return { ok: false, reason: "invalid lamport" };
  if (!event.idempotencyKey) return { ok: false, reason: "missing idempotencyKey" };
  if (!event.prevHash) return { ok: false, reason: "missing prevHash" };
  if (!event.payload || typeof event.payload !== "object") return { ok: false, reason: "invalid payload" };
  if (!event.createdAt || Number.isNaN(Date.parse(event.createdAt))) return { ok: false, reason: "invalid createdAt" };

  const expected = eventHash({
    id: event.id,
    deviceId: event.deviceId,
    seq: event.seq,
    lamport: event.lamport,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
    idempotencyKey: event.idempotencyKey,
    prevHash: event.prevHash
  });

  if (expected !== event.hash) return { ok: false, reason: "hash mismatch" };
  return { ok: true };
}

export function sortEvents(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport;
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.id.localeCompare(b.id);
  });
}
