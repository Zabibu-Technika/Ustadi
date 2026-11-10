import type { TriggerSummary } from "./types.ts";

export const HEARTBEAT_SECONDS = 300;

/**
 * A proactive agent is a durable ledger plus triggers.
 *
 * Each trigger maps to the rules that should re-run when it fires. The counter
 * server broadcasts a state refresh after every event and on a heartbeat, so
 * the inbox stays current without the owner asking.
 */
export const TRIGGERS: TriggerSummary[] = [
  {
    id: "sale.completed",
    name: "Sale completed",
    kind: "event",
    description: "Re-evaluate stock cover, margin, cash, and the daily brief after every sale."
  },
  {
    id: "order.created",
    name: "Order created",
    kind: "event",
    description: "Put the order in the inbox and watch its age."
  },
  {
    id: "stock.adjusted",
    name: "Stock adjusted",
    kind: "event",
    description: "Re-check stockout risk after a manual stock movement."
  },
  {
    id: "expense.recorded",
    name: "Expense recorded",
    kind: "event",
    description: "Re-check the cash gap after an expense."
  },
  {
    id: "low-stock",
    name: "Low stock threshold",
    kind: "threshold",
    description: "A product fell to or below its low-stock line."
  },
  {
    id: "morning",
    name: "Morning brief",
    kind: "schedule",
    description: "Evaluate the daily brief when the counter opens."
  },
  {
    id: "heartbeat",
    name: "Heartbeat",
    kind: "schedule",
    description: "Re-run the rules every five minutes while the counter is open."
  }
];
