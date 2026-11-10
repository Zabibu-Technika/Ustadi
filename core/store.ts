import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { GENESIS_HASH, createEvent, verifyEvent } from "./events.ts";
import type { DeviceMeta, EventType, LedgerEvent } from "./types.ts";
import { pairingCode, randomId } from "./canonical.ts";

export class SyncGapError extends Error {
  readonly deviceId: string;
  readonly expected: number;
  readonly got: number;

  constructor(deviceId: string, expected: number, got: number) {
    super(`sync gap for ${deviceId}: expected ${expected}, got ${got}`);
    this.deviceId = deviceId;
    this.expected = expected;
    this.got = got;
  }
}

export class FileStore {
  readonly dataDir: string;
  meta: DeviceMeta;
  events: LedgerEvent[];

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
    this.meta = this.loadMeta();
    this.events = this.loadEvents();
  }

  private metaPath(): string {
    return join(this.dataDir, "meta.json");
  }

  private ledgerPath(): string {
    return join(this.dataDir, "ledger.jsonl");
  }

  private loadMeta(): DeviceMeta {
    if (existsSync(this.metaPath())) {
      try {
        const parsed = JSON.parse(readFileSync(this.metaPath(), "utf8")) as DeviceMeta;
        if (parsed.deviceId && parsed.deviceName && parsed.pairingCode) return parsed;
      } catch {
        // fall through to a fresh identity
      }
    }
    const meta: DeviceMeta = {
      deviceId: randomId("dev-"),
      deviceName: hostname() || "Ustadi Counter",
      createdAt: new Date().toISOString(),
      pairingCode: pairingCode(),
      lastSeq: 0
    };
    writeFileSync(this.metaPath(), JSON.stringify(meta, null, 2) + "\n", "utf8");
    return meta;
  }

  private loadEvents(): LedgerEvent[] {
    if (!existsSync(this.ledgerPath())) return [];
    const lines = readFileSync(this.ledgerPath(), "utf8").split(/\r?\n/);
    const events: LedgerEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as LedgerEvent;
        if (verifyEvent(event).ok) events.push(event);
      } catch {
        // A torn write costs one line, not the ledger.
      }
    }
    return events;
  }

  saveMeta(): void {
    writeFileSync(this.metaPath(), JSON.stringify(this.meta, null, 2) + "\n", "utf8");
  }

  private persist(event: LedgerEvent): void {
    appendFileSync(this.ledgerPath(), JSON.stringify(event) + "\n", "utf8");
  }

  maxLamport(): number {
    let max = 0;
    for (const event of this.events) if (event.lamport > max) max = event.lamport;
    return max;
  }

  lastLocalHash(): string {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (event && event.deviceId === this.meta.deviceId) return event.hash;
    }
    return GENESIS_HASH;
  }

  vector(): Record<string, number> {
    const vector: Record<string, number> = {};
    for (const event of this.events) {
      vector[event.deviceId] = Math.max(vector[event.deviceId] ?? 0, event.seq);
    }
    return vector;
  }

  appendLocal(
    type: EventType,
    payload: Record<string, unknown>,
    options: { createdAt?: string; idempotencyKey?: string } = {}
  ): LedgerEvent {
    const seq = this.meta.lastSeq + 1;
    const event = createEvent({
      deviceId: this.meta.deviceId,
      seq,
      lamport: this.maxLamport() + 1,
      type,
      payload,
      createdAt: options.createdAt,
      idempotencyKey: options.idempotencyKey ?? `${this.meta.deviceId}:${seq}`,
      prevHash: this.lastLocalHash()
    });
    const validation = verifyEvent(event);
    if (!validation.ok) throw new Error(`refusing invalid local event: ${validation.reason}`);
    this.persist(event);
    this.events.push(event);
    this.meta.lastSeq = seq;
    this.saveMeta();
    return event;
  }

  hasEvent(id: string, idempotencyKey: string): boolean {
    return this.events.some((e) => e.id === id || e.idempotencyKey === idempotencyKey);
  }

  appendRemote(event: LedgerEvent): { accepted: boolean; reason?: string } {
    const validation = verifyEvent(event);
    if (!validation.ok) return { accepted: false, reason: validation.reason };
    if (this.hasEvent(event.id, event.idempotencyKey)) return { accepted: false, reason: "duplicate" };

    const current = this.vector()[event.deviceId] ?? 0;
    if (event.seq <= current) return { accepted: false, reason: "already known" };

    if (event.seq === current + 1) {
      const expectedPrev = this.lastHashFor(event.deviceId);
      if (expectedPrev && event.prevHash !== expectedPrev) {
        return { accepted: false, reason: "previous hash mismatch" };
      }
    }

    this.persist(event);
    this.events.push(event);
    return { accepted: true };
  }

  lastHashFor(deviceId: string): string | null {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (event && event.deviceId === deviceId) return event.hash;
    }
    return null;
  }

  backup(): { exportedAt: string; meta: DeviceMeta; events: LedgerEvent[] } {
    return { exportedAt: new Date().toISOString(), meta: this.meta, events: this.events };
  }
}
