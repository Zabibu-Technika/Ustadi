import type { LedgerEvent, Projection } from "../types.ts";
import { localDate } from "../canonical.ts";
import { buildFacts } from "./facts.ts";
import { DEFAULT_RULES } from "./rules.ts";
import { toolSummaries } from "./tools.ts";
import { HEARTBEAT_SECONDS, TRIGGERS } from "./triggers.ts";
import type { BusinessDecision, DecisionRecord, Intelligence } from "./types.ts";

const SEVERITY_ORDER: Record<BusinessDecision["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1
};

export function decisionRecords(events: LedgerEvent[]): Map<string, DecisionRecord> {
  const records = new Map<string, DecisionRecord>();
  for (const event of events) {
    if (event.type !== "decision.recorded") continue;
    const record = event.payload as unknown as DecisionRecord;
    if (!record.decisionId) continue;
    const existing = records.get(record.decisionId);
    if (!existing || existing.at <= record.at) records.set(record.decisionId, record);
  }
  return records;
}

export function generateIntelligence(
  projection: Projection,
  events: LedgerEvent[],
  date = localDate()
): Intelligence {
  const facts = buildFacts(projection, date);
  const records = decisionRecords(events);
  const context = { projection, facts, records, date };
  const decisions = DEFAULT_RULES.flatMap((rule) => {
    try {
      return rule.evaluate(context);
    } catch {
      return [];
    }
  });

  const unique = new Map<string, BusinessDecision>();
  for (const decision of decisions) {
    if (decision.status === "dismissed" || decision.status === "done") continue;
    const existing = unique.get(decision.decisionId);
    if (!existing || decision.impactCents * decision.confidence > existing.impactCents * existing.confidence) {
      unique.set(decision.decisionId, decision);
    }
  }

  const ranked = [...unique.values()].sort((a, b) => {
    const severity = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (severity !== 0) return severity;
    return b.impactCents * b.confidence - a.impactCents * a.confidence;
  }).slice(0, 12);

  return {
    generatedAt: new Date().toISOString(),
    businessDate: date,
    facts,
    decisions: ranked,
    tools: toolSummaries(),
    proactive: {
      lastEvaluatedAt: new Date().toISOString(),
      heartbeatSeconds: HEARTBEAT_SECONDS,
      triggers: TRIGGERS
    }
  };
}
