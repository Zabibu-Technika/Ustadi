import type { Projection } from "../types.ts";
import { daysAgo, formatKes, localDate } from "../canonical.ts";
import type { BusinessFacts, DecisionDiagnosis, ProductFact } from "./types.ts";

function sumDays(projection: Projection, startOffset: number, days: number, date: string): number {
  const base = new Date(`${date}T12:00:00`);
  let total = 0;
  for (let i = startOffset; i < startOffset + days; i += 1) {
    const key = daysAgo(i, base);
    total += projection.days[key]?.salesCents ?? 0;
  }
  return total;
}

export function diagnoseSales(projection: Projection, date = localDate()): DecisionDiagnosis | null {
  const last7 = sumDays(projection, 0, 7, date);
  const prev7 = sumDays(projection, 7, 7, date);
  if (prev7 <= 0) return null;
  const delta = last7 - prev7;
  const pct = Math.round((delta / prev7) * 100);

  const byProduct = new Map<string, number>();
  const byChannel = new Map<string, number>();
  const windowStart = daysAgo(13, new Date(`${date}T12:00:00`));
  for (const sale of projection.sales) {
    if (sale.refunded || sale.businessDate < windowStart) continue;
    for (const line of sale.lines) {
      byProduct.set(line.name, (byProduct.get(line.name) ?? 0) + line.qty * line.unitPriceCents);
    }
    byChannel.set(sale.channel, (byChannel.get(sale.channel) ?? 0) + sale.totalCents);
  }

  const contributions = [...byProduct.entries()]
    .map(([label, valueCents]) => ({ label, valueCents, share: delta !== 0 ? valueCents / Math.abs(delta) : 0 }))
    .sort((a, b) => b.valueCents - a.valueCents)
    .slice(0, 5);

  return {
    summary: `Sales are ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% versus the previous 7 days. ${contributions[0] ? `${contributions[0].label} is the largest revenue line.` : ""}`,
    contributions
  };
}

export function diagnoseMargin(fact: ProductFact): DecisionDiagnosis {
  const revenue = Math.max(1, fact.revenue14);
  return {
    summary: `Gross margin is ${((fact.marginPct ?? 0) * 100).toFixed(1)}% on ${formatKes(fact.revenue14)} of sales. Cost of goods is ${((fact.cost14 / revenue) * 100).toFixed(1)}% of revenue.`,
    contributions: [
      { label: "Cost of goods", valueCents: fact.cost14, share: fact.cost14 / revenue },
      { label: "Gross profit", valueCents: fact.revenue14 - fact.cost14, share: (fact.revenue14 - fact.cost14) / revenue }
    ]
  };
}

export function diagnoseStockout(fact: ProductFact): DecisionDiagnosis {
  return {
    summary: `${fact.name} has ${fact.stock} left, about ${fact.stockCoverDays === null ? "unknown" : fact.stockCoverDays.toFixed(1)} days of cover at the current velocity. Supplier lead time is ${fact.supplierLeadDays} days.`,
    contributions: [
      { label: "Stock on hand", valueCents: fact.stock * fact.priceCents, share: 1 },
      { label: "Daily sales velocity", valueCents: Math.round(fact.velocityPerDay * fact.priceCents), share: 0 }
    ]
  };
}

export function diagnoseCash(facts: BusinessFacts): DecisionDiagnosis {
  return {
    summary: `Cash position is ${formatKes(facts.cashPositionCents)}. Average daily expenses are ${formatKes(facts.avgDailyExpensesCents)}${facts.cashRunwayDays === null ? "" : `, about ${facts.cashRunwayDays.toFixed(1)} days of runway`}.`,
    contributions: [
      { label: "Cash position", valueCents: facts.cashPositionCents, share: 1 },
      { label: "Pending orders", valueCents: facts.pendingOrdersValueCents, share: 0 }
    ]
  };
}

export function diagnoseOrders(facts: BusinessFacts, orders: Array<{ customerName: string; totalCents: number }>): DecisionDiagnosis {
  return {
    summary: `${facts.pendingOrdersCount} order${facts.pendingOrdersCount === 1 ? "" : "s"} worth ${formatKes(facts.pendingOrdersValueCents)} are waiting${facts.oldestOrderHours === null ? "" : `; the oldest is ${facts.oldestOrderHours.toFixed(1)} hours old`}.`,
    contributions: orders.slice(0, 5).map((order) => ({
      label: order.customerName || "Walk-in",
      valueCents: order.totalCents,
      share: facts.pendingOrdersValueCents > 0 ? order.totalCents / facts.pendingOrdersValueCents : 0
    }))
  };
}
