import type { Projection } from "../types.ts";
import { formatKes, sha256Hex } from "../canonical.ts";
import type {
  BusinessDecision,
  BusinessFacts,
  DecisionRecord,
  DecisionStatus,
  ProductFact
} from "./types.ts";
import { diagnoseCash, diagnoseMargin, diagnoseOrders, diagnoseSales, diagnoseStockout } from "./diagnose.ts";
import {
  cashAction,
  discountAction,
  marginAction,
  orderAction,
  planReorder,
  reorderAction
} from "./plan.ts";

export interface RuleContext {
  projection: Projection;
  facts: BusinessFacts;
  records: Map<string, DecisionRecord>;
  date: string;
}

export interface Rule {
  id: string;
  name: string;
  evaluate(context: RuleContext): BusinessDecision[];
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function decisionId(ruleId: string, entityId: string, date: string): string {
  return `${ruleId.replace(/[^a-z0-9]+/gi, "-")}-${sha256Hex(`${ruleId}:${entityId}:${date}`).slice(0, 10)}`;
}

function statusFor(id: string, records: Map<string, DecisionRecord>): DecisionStatus {
  return records.get(id)?.status ?? "proposed";
}

function buildDecision(input: {
  ruleId: string;
  ruleName: string;
  trigger?: string;
  entityId: string;
  date: string;
  records: Map<string, DecisionRecord>;
  title: string;
  summary: string;
  severity: BusinessDecision["severity"];
  impactCents: number;
  confidence: number;
  evidence: BusinessDecision["evidence"];
  assumptions: string[];
  action: BusinessDecision["action"];
  diagnosis?: BusinessDecision["diagnosis"];
  draft?: BusinessDecision["draft"];
}): BusinessDecision {
  const id = decisionId(input.ruleId, input.entityId, input.date);
  return {
    decisionId: id,
    ruleId: input.ruleId,
    ruleName: input.ruleName,
    trigger: input.trigger ?? "heartbeat",
    entityId: input.entityId,
    title: input.title,
    summary: input.summary,
    severity: input.severity,
    impactCents: Math.round(input.impactCents),
    confidence: Math.round(clamp(input.confidence) * 100) / 100,
    status: statusFor(id, input.records),
    evidence: input.evidence,
    assumptions: input.assumptions,
    action: input.action,
    diagnosis: input.diagnosis,
    draft: input.draft,
    createdAt: new Date().toISOString()
  };
}

export const stockoutRule: Rule = {
  id: "stockout-risk",
  name: "Stockout risk",
  evaluate({ facts, records, date }) {
    return facts.products.flatMap((fact) => {
      if (fact.stock <= 0 || fact.velocityPerDay <= 0.1 || fact.stockCoverDays === null) return [];
      const safetyDays = 2;
      if (fact.stockCoverDays > fact.supplierLeadDays + safetyDays) return [];
      const plan = planReorder(fact, facts);
      const severity = fact.stockCoverDays <= fact.supplierLeadDays ? "high" : "medium";
      return [buildDecision({
        ruleId: this.id,
        ruleName: this.name,
        entityId: fact.productId,
        date,
        records,
        trigger: "sale.completed",
        title: `Reorder ${fact.name} now`,
        summary: `${fact.stock} left · ${fact.stockCoverDays.toFixed(1)} days of cover · supplier lead time ${fact.supplierLeadDays} days.${plan.cashConstrained ? ` Target ${plan.targetQty}; cash supports ${plan.qty} now.` : ""}`,
        severity,
        impactCents: plan.impactCents,
        confidence: 0.55 + facts.dataQuality * 0.3,
        evidence: [
          { label: "Stock", value: `${fact.stock}` },
          { label: "Velocity", value: `${fact.velocityPerDay.toFixed(2)} / day` },
          { label: "Cover", value: `${fact.stockCoverDays.toFixed(1)} days` },
          { label: "Lead time", value: `${fact.supplierLeadDays} days` },
          { label: "Target order", value: `${plan.targetQty} units` },
          { label: "Affordable now", value: `${plan.qty} units` },
          { label: "Target cost", value: formatKes(plan.targetCostCents) },
          { label: "Cash after", value: formatKes(facts.cashPositionCents - plan.targetCostCents) }
        ],
        assumptions: [
          `Sales velocity is based on the last 14 days (${facts.businessDate}).`,
          `Safety stock is ${safetyDays} days; review period is 3 days.`,
          plan.cashConstrained ? "The order is limited by the cash buffer." : "The order fits inside the cash buffer."
        ],
        action: reorderAction(fact, plan),
        diagnosis: diagnoseStockout(fact),
        draft: plan.qty > 0 ? { channel: "note", text: `Order ${plan.qty} × ${fact.name}. Estimated cost ${formatKes(plan.costCents)}.` } : undefined
      })];
    });
  }
};

export const deadStockRule: Rule = {
  id: "dead-stock",
  name: "Dead stock",
  evaluate({ facts, records, date }) {
    const now = Date.now();
    return facts.products.flatMap((fact) => {
      if (fact.stock <= 0 || fact.stockValueCents < 50_000) return [];
      const last = fact.lastSoldAt ? Date.parse(fact.lastSoldAt) : null;
      const daysSince = last === null ? 999 : (now - last) / 86_400_000;
      if (daysSince < 21) return [];
      return [buildDecision({
        ruleId: this.id,
        ruleName: this.name,
        entityId: fact.productId,
        date,
        records,
        trigger: "heartbeat",
        title: `Release cash from ${fact.name}`,
        summary: `${fact.stock} units · ${formatKes(fact.stockValueCents)} tied up · no sale in ${daysSince > 900 ? "the ledger" : `${Math.floor(daysSince)} days`}.`,
        severity: fact.stockValueCents > 500_000 ? "high" : "medium",
        impactCents: fact.stockValueCents,
        confidence: 0.7 + facts.dataQuality * 0.15,
        evidence: [
          { label: "Stock", value: `${fact.stock}` },
          { label: "Stock value", value: formatKes(fact.stockValueCents) },
          { label: "Last sold", value: fact.lastSoldAt ? fact.lastSoldAt.slice(0, 10) : "never" },
          { label: "14-day units", value: `${fact.units14}` }
        ],
        assumptions: ["Dead stock is measured over 21 days.", "A discount or bundle is a proposal, not an automatic price change."],
        action: discountAction(fact),
        diagnosis: {
          summary: `This stock is not moving. Releasing it converts shelf space and cost back into cash.`,
          contributions: [
            { label: "Cash tied up", valueCents: fact.stockValueCents, share: 1 },
            { label: "Unsold units", valueCents: fact.stock * fact.priceCents, share: 0 }
          ]
        }
      })];
    });
  }
};

export const marginRule: Rule = {
  id: "margin-leak",
  name: "Margin leak",
  evaluate({ facts, records, date }) {
    return facts.products.flatMap((fact) => {
      if (fact.revenue14 < 10_000 || fact.marginPct === null) return [];
      const target = 0.2;
      if (fact.marginPct >= target) return [];
      const gap = (target - fact.marginPct) * fact.revenue14;
      return [buildDecision({
        ruleId: this.id,
        ruleName: this.name,
        entityId: fact.productId,
        date,
        records,
        trigger: "sale.completed",
        title: `Protect margin on ${fact.name}`,
        summary: `Margin is ${(fact.marginPct * 100).toFixed(1)}% versus a 20% target · ${formatKes(fact.revenue14)} sold in 14 days.`,
        severity: fact.marginPct < 0.1 ? "high" : "medium",
        impactCents: gap,
        confidence: 0.75 + facts.dataQuality * 0.15,
        evidence: [
          { label: "Margin", value: `${(fact.marginPct * 100).toFixed(1)}%` },
          { label: "Target", value: "20.0%" },
          { label: "Revenue 14d", value: formatKes(fact.revenue14) },
          { label: "Cost 14d", value: formatKes(fact.cost14) }
        ],
        assumptions: ["Target margin is 20% until the shop sets its own.", "Costs are recorded per unit at sale time."],
        action: marginAction(fact),
        diagnosis: diagnoseMargin(fact)
      })];
    });
  }
};

export const cashGapRule: Rule = {
  id: "cash-gap",
  name: "Cash gap",
  evaluate({ facts, records, date }) {
    const runwayGap = facts.cashRunwayDays !== null && facts.cashRunwayDays < 7
      ? facts.avgDailyExpensesCents * 7 - facts.cashPositionCents
      : 0;
    const bufferGap = facts.minimumCashCents - facts.cashPositionCents;
    const gap = Math.max(0, runwayGap, bufferGap);
    if (gap <= 0) return [];
    return [buildDecision({
      ruleId: this.id,
      ruleName: this.name,
      entityId: "cash",
      date,
      records,
      trigger: "expense.recorded",
      title: "Close the cash gap",
      summary: `Cash is ${formatKes(facts.cashPositionCents)}; a safe buffer is ${formatKes(facts.minimumCashCents)}.`,
      severity: "high",
      impactCents: gap,
      confidence: 0.8,
      evidence: [
        { label: "Cash position", value: formatKes(facts.cashPositionCents) },
        { label: "Daily expenses", value: formatKes(facts.avgDailyExpensesCents) },
        { label: "Runway", value: facts.cashRunwayDays === null ? "unknown" : `${facts.cashRunwayDays.toFixed(1)} days` },
        { label: "Pending orders", value: formatKes(facts.pendingOrdersValueCents) }
      ],
      assumptions: ["Customer credit balances are not yet modelled; pending orders are the visible near-term inflow.", "Recurring expenses are averaged over the last 14 days."],
      action: cashAction(facts),
      diagnosis: diagnoseCash(facts)
    })];
  }
};

export const pendingOrdersRule: Rule = {
  id: "order-follow-up",
  name: "Order follow-up",
  evaluate({ projection, facts, records, date }) {
    return projection.pendingOrders.map((order) => {
      const ageHours = Math.max(0, (Date.now() - Date.parse(order.createdAt)) / 3_600_000);
      const items = order.lines.map((line) => `${line.qty} × ${line.name}`).join(", ");
      return buildDecision({
        ruleId: this.id,
        ruleName: this.name,
        entityId: order.orderId,
        date,
        records,
        trigger: "order.created",
        title: `Fulfil ${order.customerName || "the order"} · ${formatKes(order.totalCents)}`,
        summary: `${order.channel} · ${items} · ${ageHours.toFixed(1)} hours old.`,
        severity: ageHours > 24 || order.totalCents > 50_000 ? "high" : "medium",
        impactCents: order.totalCents,
        confidence: 0.9,
        evidence: [
          { label: "Channel", value: order.channel },
          { label: "Total", value: formatKes(order.totalCents) },
          { label: "Age", value: `${ageHours.toFixed(1)} hours` },
          { label: "Status", value: order.status }
        ],
        assumptions: ["The order is not fulfilled until the sale is recorded.", "A WhatsApp draft is prepared, not sent."],
        action: orderAction(order),
        diagnosis: diagnoseOrders(facts, [order]),
        draft: {
          channel: "whatsapp",
          text: `Hi ${order.customerName || "there"}, your Ustadi order (${items}) is ready. Total ${formatKes(order.totalCents)}.`
        }
      });
    });
  }
};

export const salesTrendRule: Rule = {
  id: "sales-trend",
  name: "Sales anomaly",
  evaluate({ projection, facts, records, date }) {
    if (facts.trendPct === null || facts.trendPct > -0.2 || facts.salesPrev7Cents < 100_000 || facts.dataQuality < 0.6) return [];
    const diagnosis = diagnoseSales(projection, date);
    if (!diagnosis) return [];
    return [buildDecision({
      ruleId: this.id,
      ruleName: this.name,
      entityId: date,
      date,
      records,
      trigger: "morning",
      title: `Sales are down ${Math.abs(Math.round(facts.trendPct * 100))}%`,
      summary: `Last 7 days ${formatKes(facts.sales7Cents)} versus ${formatKes(facts.salesPrev7Cents)} the week before.`,
      severity: facts.trendPct <= -0.3 ? "high" : "medium",
      impactCents: Math.abs(facts.sales7Cents - facts.salesPrev7Cents),
      confidence: 0.7 + facts.dataQuality * 0.15,
      evidence: [
        { label: "This week", value: formatKes(facts.sales7Cents) },
        { label: "Last week", value: formatKes(facts.salesPrev7Cents) },
        { label: "Change", value: `${Math.round(facts.trendPct * 100)}%` }
      ],
      assumptions: ["A drop is only flagged when the previous week had enough sales to compare.", "The diagnosis shows revenue lines, not causality."],
      action: { type: "investigate", label: "Review the contribution breakdown" },
      diagnosis
    })];
  }
};

export const DEFAULT_RULES: Rule[] = [
  cashGapRule,
  stockoutRule,
  pendingOrdersRule,
  marginRule,
  deadStockRule,
  salesTrendRule
];
