export type DecisionSeverity = "high" | "medium" | "low";
export type DecisionStatus = "proposed" | "approved" | "dismissed" | "done";
export type DecisionActionType =
  | "reorder"
  | "discount"
  | "price"
  | "collect"
  | "fulfill"
  | "cash"
  | "investigate";

export interface DecisionEvidence {
  label: string;
  value: string;
}

export interface DecisionContribution {
  label: string;
  valueCents: number;
  share: number;
}

export interface DecisionDiagnosis {
  summary: string;
  contributions: DecisionContribution[];
}

export interface DecisionAction {
  type: DecisionActionType;
  label: string;
  productId?: string;
  orderId?: string;
  qty?: number;
  amountCents?: number;
}

export interface DecisionDraft {
  channel: "whatsapp" | "note";
  text: string;
}

export interface BusinessDecision {
  decisionId: string;
  ruleId: string;
  ruleName: string;
  trigger: string;
  title: string;
  summary: string;
  severity: DecisionSeverity;
  impactCents: number;
  confidence: number;
  status: DecisionStatus;
  entityId?: string;
  evidence: DecisionEvidence[];
  assumptions: string[];
  action: DecisionAction;
  diagnosis?: DecisionDiagnosis;
  draft?: DecisionDraft;
  createdAt: string;
}

export interface DecisionRecord {
  decisionId: string;
  ruleId: string;
  status: DecisionStatus;
  at: string;
  note?: string;
}

export interface ProductFact {
  productId: string;
  name: string;
  stock: number;
  priceCents: number;
  costCents: number;
  lowStockAt: number;
  supplierLeadDays: number;
  units14: number;
  revenue14: number;
  cost14: number;
  marginPct: number | null;
  velocityPerDay: number;
  stockCoverDays: number | null;
  lastSoldAt: string | null;
  stockValueCents: number;
}

export interface BusinessFacts {
  businessDate: string;
  dataQuality: number;
  cashPositionCents: number;
  avgDailyExpensesCents: number;
  cashRunwayDays: number | null;
  minimumCashCents: number;
  pendingOrdersCount: number;
  pendingOrdersValueCents: number;
  oldestOrderHours: number | null;
  salesTodayCents: number;
  sales7Cents: number;
  salesPrev7Cents: number;
  trendPct: number | null;
  products: ProductFact[];
  channelMix: Array<{ channel: string; revenueCents: number; share: number }>;
}

export interface Intelligence {
  generatedAt: string;
  businessDate: string;
  facts: BusinessFacts;
  decisions: BusinessDecision[];
  tools: ToolSummary[];
  proactive: {
    lastEvaluatedAt: string;
    heartbeatSeconds: number;
    triggers: TriggerSummary[];
  };
}

export interface ToolSummary {
  id: string;
  name: string;
  description: string;
  capability: "read" | "local-write" | "egress" | "destructive";
  mutating: boolean;
  requiresApproval: boolean;
}

export interface TriggerSummary {
  id: string;
  name: string;
  kind: "event" | "schedule" | "threshold";
  description: string;
}

