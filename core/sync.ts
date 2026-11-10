import type { LedgerEvent, SyncResult } from "./types.ts";
import { sortEvents } from "./events.ts";
import { FileStore } from "./store.ts";

export function vectorOf(events: LedgerEvent[]): Record<string, number> {
  const vector: Record<string, number> = {};
  for (const event of events) vector[event.deviceId] = Math.max(vector[event.deviceId] ?? 0, event.seq);
  return vector;
}

export function eventsAfter(events: LedgerEvent[], vector: Record<string, number>): LedgerEvent[] {
  return sortEvents(events.filter((event) => event.seq > (vector[event.deviceId] ?? 0)));
}

export interface MergeResult {
  accepted: number;
  skipped: number;
  gaps: Array<{ deviceId: string; expected: number; got: number }>;
}

export function mergeEvents(store: FileStore, remoteEvents: LedgerEvent[]): MergeResult {
  const ordered = [...remoteEvents].sort((a, b) => {
    if (a.deviceId !== b.deviceId) return a.deviceId.localeCompare(b.deviceId);
    return a.seq - b.seq;
  });
  const result: MergeResult = { accepted: 0, skipped: 0, gaps: [] };

  for (const event of ordered) {
    if (store.hasEvent(event.id, event.idempotencyKey)) {
      result.skipped += 1;
      continue;
    }
    const current = store.vector()[event.deviceId] ?? 0;
    if (event.seq <= current) {
      result.skipped += 1;
      continue;
    }
    if (event.seq > current + 1) {
      result.gaps.push({ deviceId: event.deviceId, expected: current + 1, got: event.seq });
      continue;
    }
    const appended = store.appendRemote(event);
    if (appended.accepted) result.accepted += 1;
    else result.skipped += 1;
  }

  return result;
}

export async function syncWithPeer(store: FileStore, peerUrl: string, peerCode: string): Promise<SyncResult> {
  const base = peerUrl.replace(/\/$/, "");
  const headers = { "content-type": "application/json", "x-ustadi-pair": peerCode };

  const stateResponse = await fetch(`${base}/api/sync/state`, { headers });
  if (!stateResponse.ok) throw new Error(`peer state failed: ${stateResponse.status}`);
  const peerState = (await stateResponse.json()) as { vector: Record<string, number>; deviceId: string };

  const localVector = store.vector();
  const pullResponse = await fetch(`${base}/api/sync/pull`, {
    method: "POST",
    headers,
    body: JSON.stringify({ vector: localVector })
  });
  if (!pullResponse.ok) throw new Error(`peer pull failed: ${pullResponse.status}`);
  const pulledBody = (await pullResponse.json()) as { events: LedgerEvent[] };
  const merged = mergeEvents(store, pulledBody.events);

  const pushEvents = eventsAfter(store.events, peerState.vector);
  let pushResult = { accepted: 0, skipped: 0, gaps: [] as MergeResult["gaps"] };
  if (pushEvents.length > 0) {
    const pushResponse = await fetch(`${base}/api/sync/push`, {
      method: "POST",
      headers,
      body: JSON.stringify({ events: pushEvents })
    });
    if (!pushResponse.ok) throw new Error(`peer push failed: ${pushResponse.status}`);
    pushResult = (await pushResponse.json()) as { accepted: number; skipped: number; gaps: MergeResult["gaps"] };
  }

  if (merged.gaps.length > 0 || pushResult.gaps.length > 0) {
    const repair = await fetch(`${base}/api/sync/pull`, {
      method: "POST",
      headers,
      body: JSON.stringify({ vector: store.vector() })
    });
    if (repair.ok) {
      const body = (await repair.json()) as { events: LedgerEvent[] };
      mergeEvents(store, body.events);
    }
  }

  return {
    pulled: pulledBody.events.length,
    pushed: pushResult.accepted,
    accepted: merged.accepted,
    skipped: merged.skipped,
    gaps: [...merged.gaps, ...pushResult.gaps]
  };
}
