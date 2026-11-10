import type { Brief, BriefMetric, Projection } from "./types.ts";
import { emptyDay } from "./projection.ts";
import { daysAgo, formatKes, localDate } from "./canonical.ts";

function previousSevenAverage(projection: Projection, today: string): number {
  let total = 0;
  let count = 0;
  for (let i = 1; i <= 7; i += 1) {
    const date = daysAgo(i, new Date(`${today}T12:00:00`));
    const day = projection.days[date];
    if (day) {
      total += day.salesCents;
      count += 1;
    }
  }
  return count > 0 ? Math.round(total / count) : 0;
}

export function buildBrief(projection: Projection, date = localDate()): Brief {
  const day = projection.days[date] ?? emptyDay(date);
  const average = previousSevenAverage(projection, date);
  const metrics: BriefMetric[] = [
    { label: "Sales today", value: formatKes(day.salesCents), tone: "neutral" },
    { label: "Gross profit", value: formatKes(day.grossProfitCents), tone: day.grossProfitCents >= 0 ? "good" : "warn" },
    { label: "Cash in", value: formatKes(day.cashInCents), tone: "good" },
    { label: "Expenses", value: formatKes(day.expensesCents), tone: day.expensesCents > 0 ? "warn" : "neutral" },
    { label: "Net cash", value: formatKes(day.netCashCents), tone: day.netCashCents >= 0 ? "good" : "warn" }
  ];

  const actions: string[] = [];
  for (const product of projection.lowStock.slice(0, 3)) {
    actions.push(`Reorder ${product.name}: ${product.stock} left (alert at ${product.lowStockAt}).`);
  }
  if (projection.pendingOrders.length > 0) {
    const value = projection.pendingOrders.reduce((sum, order) => sum + order.totalCents, 0);
    actions.push(`${projection.pendingOrders.length} digital order${projection.pendingOrders.length === 1 ? "" : "s"} waiting · ${formatKes(value)}.`);
  }
  if (day.pendingCents > 0) {
    actions.push(`${formatKes(day.pendingCents)} in pending M-Pesa/card payments to confirm.`);
  }
  if (average > 0 && day.salesCents < average * 0.7) {
    const drop = Math.round((1 - day.salesCents / average) * 100);
    actions.push(`Sales are ${drop}% below your 7-day average. Check stock and follow up on regulars.`);
  }
  if (day.salesCents === 0) {
    actions.push("No sales recorded yet. Log a walk-in sale or create a WhatsApp order.");
  }
  if (actions.length === 0) {
    actions.push("Keep going. Check the low-stock list before the evening rush.");
  }

  const top = projection.topProducts[0];
  const parts = [
    `Today: ${formatKes(day.salesCents)} in sales across ${day.salesCount} sale${day.salesCount === 1 ? "" : "s"}.`,
    `Gross profit ${formatKes(day.grossProfitCents)}; cash in ${formatKes(day.cashInCents)}; net cash ${formatKes(day.netCashCents)}.`
  ];
  if (top) parts.push(`Best seller: ${top.name} (${top.qty} sold).`);
  if (projection.lowStock.length > 0) parts.push(`${projection.lowStock.length} product${projection.lowStock.length === 1 ? "" : "s"} at or below the low-stock line.`);
  if (projection.pendingOrders.length > 0) parts.push(`${projection.pendingOrders.length} order${projection.pendingOrders.length === 1 ? "" : "s"} still need action.`);

  return {
    businessDate: date,
    title: `Daily brief — ${date}`,
    text: parts.join(" "),
    metrics,
    actions: actions.slice(0, 4),
    generatedAt: new Date().toISOString()
  };
}
