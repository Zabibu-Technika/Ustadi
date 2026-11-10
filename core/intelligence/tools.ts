import type { ToolSummary } from "./types.ts";

export interface ToolDefinition extends ToolSummary {
  input: string[];
}

/**
 * The tools the intelligence layer may call.
 *
 * The rule engine can propose; these are the only actions allowed to touch
 * state. Mutating tools require explicit human approval from the decision card.
 */
export const TOOL_CATALOG: ToolDefinition[] = [
  {
    id: "draft_message",
    name: "Draft a message",
    description: "Render a WhatsApp or note draft. Does not send anything.",
    capability: "read",
    mutating: false,
    requiresApproval: false,
    input: ["text", "channel"]
  },
  {
    id: "record_decision",
    name: "Record a decision",
    description: "Approve or dismiss a proposal in the append-only ledger.",
    capability: "local-write",
    mutating: true,
    requiresApproval: true,
    input: ["decisionId", "status", "note"]
  },
  {
    id: "fulfill_order",
    name: "Fulfil an order",
    description: "Create the sale from an order, take payment, and mark it fulfilled.",
    capability: "local-write",
    mutating: true,
    requiresApproval: true,
    input: ["orderId", "method", "reference"]
  },
  {
    id: "adjust_stock",
    name: "Adjust stock",
    description: "Record a stock movement with a reason.",
    capability: "local-write",
    mutating: true,
    requiresApproval: true,
    input: ["productId", "delta", "reason"]
  },
  {
    id: "record_expense",
    name: "Record an expense",
    description: "Add an expense to the local ledger.",
    capability: "local-write",
    mutating: true,
    requiresApproval: true,
    input: ["category", "amountCents", "note"]
  }
];

export function findTool(id: string): ToolDefinition | undefined {
  return TOOL_CATALOG.find((tool) => tool.id === id);
}

export function toolSummaries(): ToolSummary[] {
  return TOOL_CATALOG.map(({ input: _input, ...summary }) => summary);
}
