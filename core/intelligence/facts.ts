import type { Projection, Sale } from "../types.ts";
import { daysAgo, localDate } from "../canonical.ts";
import type { BusinessFacts, ProductFact } from "./types.ts";

function dayCents(projection: Projection, date: string): number {
  return projection.days[date]?.salesCents ?? 0;
}

function dayDistance(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function activeSales(projection: Projection): Sale[] {
  return projection.sales.filter((sale) => !sale.refunded);
}

export function buildFacts(
  projection: Projection,
  date = localDate(),
  now = new Date()
): BusinessFacts {
  const sales = activeSales(projection);
  const salesByDate = new Set(sales.map((sale) => sale.businessDate));
  const earliest = [...salesByDate].sort()[0] ?? date;
  const observedDays = Math.max(1, Math.min(14, dayDistance(earliest, date) + 1));
  const windowStart = daysAgo(13, new Date(`${date}T12:00:00`));

  const productFacts = projection.products.filter((product) => product.active).map((product) => {
    let units14 = 0;
    let revenue14 = 0;
    let cost14 = 0;
    let lastSoldAt: string | null = null;

    for (const sale of sales) {
      if (sale.businessDate >= windowStart) {
        for (const line of sale.lines) {
          if (line.productId !== product.productId) continue;
          units14 += line.qty;
          revenue14 += line.qty * line.unitPriceCents;
          cost14 += line.qty * line.unitCostCents;
        }
      }
      for (const line of sale.lines) {
        if (line.productId !== product.productId) continue;
        if (!lastSoldAt || sale.createdAt > lastSoldAt) lastSoldAt = sale.createdAt;
      }
    }

    const velocityPerDay = units14 / observedDays;
    const marginPct = revenue14 > 0 ? (revenue14 - cost14) / revenue14 : null;
    return {
      productId: product.productId,
      name: product.name,
      stock: product.stock,
      priceCents: product.priceCents,
      costCents: product.costCents,
      lowStockAt: product.lowStockAt,
      supplierLeadDays: product.supplierLeadDays ?? 2,
      units14,
      revenue14,
      cost14,
      marginPct,
      velocityPerDay,
      stockCoverDays: velocityPerDay > 0 ? product.stock / velocityPerDay : null,
      lastSoldAt,
      stockValueCents: product.stock * product.costCents
    } satisfies ProductFact;
  });

  const expenses14 = projection.expenses
    .filter((expense) => expense.businessDate >= windowStart)
    .reduce((sum, expense) => sum + expense.amountCents, 0);
  const avgDailyExpensesCents = Math.round(expenses14 / 14);
  const cashPositionCents = projection.cashPositionCents;
  const minimumCashCents = 100_000;

  const pending = projection.pendingOrders;
  const pendingOrdersValueCents = pending.reduce((sum, order) => sum + order.totalCents, 0);
  const oldestOrderHours = pending.length
    ? Math.max(0, (now.getTime() - Math.min(...pending.map((order) => Date.parse(order.createdAt)))) / 3_600_000)
    : null;

  const salesTodayCents = dayCents(projection, date);
  const sales7Cents = Array.from({ length: 7 }, (_, index) => dayCents(projection, daysAgo(index, new Date(`${date}T12:00:00`)))).reduce((a, b) => a + b, 0);
  const salesPrev7Cents = Array.from({ length: 7 }, (_, index) => dayCents(projection, daysAgo(index + 7, new Date(`${date}T12:00:00`)))).reduce((a, b) => a + b, 0);
  const trendPct = salesPrev7Cents > 0 ? (sales7Cents - salesPrev7Cents) / salesPrev7Cents : null;

  const channelTotals = new Map<string, number>();
  for (const sale of sales) {
    if (sale.businessDate < windowStart) continue;
    channelTotals.set(sale.channel, (channelTotals.get(sale.channel) ?? 0) + sale.totalCents);
  }
  const channelTotal = [...channelTotals.values()].reduce((a, b) => a + b, 0);
  const channelMix = [...channelTotals.entries()]
    .map(([channel, revenueCents]) => ({
      channel,
      revenueCents,
      share: channelTotal > 0 ? revenueCents / channelTotal : 0
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  const goodProducts = projection.products.filter((product) =>
    product.active && product.name.length > 0 && product.priceCents > 0 && product.costCents > 0
  ).length;
  const coverage = projection.products.length > 0 ? goodProducts / projection.products.length : 0;
  const history = Math.min(1, salesByDate.size / 7);
  const dataQuality = Math.max(0, Math.min(1, 0.4 + coverage * 0.4 + history * 0.2));

  return {
    businessDate: date,
    dataQuality,
    cashPositionCents,
    avgDailyExpensesCents,
    cashRunwayDays: avgDailyExpensesCents > 0 ? cashPositionCents / avgDailyExpensesCents : null,
    minimumCashCents,
    pendingOrdersCount: pending.length,
    pendingOrdersValueCents,
    oldestOrderHours,
    salesTodayCents,
    sales7Cents,
    salesPrev7Cents,
    trendPct,
    products: productFacts,
    channelMix
  };
}
