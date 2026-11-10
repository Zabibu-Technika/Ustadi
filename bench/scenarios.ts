import { createEvent } from "../core/events.ts";
import { project, saleTotals } from "../core/projection.ts";
import { daysAgo, isoAtLocalTime, localDate } from "../core/canonical.ts";
import type { Expense, LedgerEvent, Order, Product, Projection, Sale, SaleChannel, SaleLine, SalePayment } from "../core/types.ts";

export type GoldAction = "reorder" | "discount" | "price" | "fulfill" | "cash" | "investigate" | "none";

export interface Scenario {
  id: string;
  title: string;
  description: string;
  projection: Projection;
  gold: { action: GoldAction; entityId?: string };
  expectedRule?: string;
}

export const TODAY = localDate();

export function product(
  productId: string,
  name: string,
  priceCents: number,
  costCents: number,
  stock: number,
  lowStockAt = 5,
  supplierLeadDays = 2
): Product {
  return {
    productId,
    name,
    sku: productId.toUpperCase(),
    priceCents,
    costCents,
    stock,
    lowStockAt,
    active: true,
    updatedAt: new Date().toISOString(),
    supplierLeadDays
  };
}

export function sale(
  saleId: string,
  daysBack: number,
  hour: number,
  items: Array<[Product, number]>,
  method: SalePayment["method"] = "cash",
  status: SalePayment["status"] = "confirmed",
  channel: SaleChannel = "walk-in",
  customerName?: string
): Sale {
  const lines: SaleLine[] = items.map(([item, qty]) => ({
    productId: item.productId,
    name: item.name,
    qty,
    unitPriceCents: item.priceCents,
    unitCostCents: item.costCents
  }));
  const totals = saleTotals(lines);
  const businessDate = daysAgo(daysBack);
  return {
    saleId,
    channel,
    lines,
    subtotalCents: totals.subtotalCents,
    discountCents: 0,
    taxCents: 0,
    totalCents: totals.totalCents,
    costCents: totals.costCents,
    payments: [{ method, amountCents: totals.totalCents, status }],
    customerName,
    businessDate,
    createdAt: isoAtLocalTime(businessDate, hour, 0)
  };
}

export function order(
  orderId: string,
  daysBack: number,
  hour: number,
  customerName: string,
  items: Array<[Product, number]>,
  status: Order["status"] = "new",
  channel: SaleChannel = "whatsapp"
): Order {
  const lines = items.map(([item, qty]) => ({
    productId: item.productId,
    name: item.name,
    qty,
    unitPriceCents: item.priceCents,
    unitCostCents: item.costCents
  }));
  return {
    orderId,
    channel,
    customerName,
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0),
    status,
    createdAt: isoAtLocalTime(daysAgo(daysBack), hour, 0)
  };
}

export function expense(expenseId: string, category: string, amountCents: number, daysBack = 0): Expense {
  return {
    expenseId,
    category,
    amountCents,
    note: category,
    businessDate: daysAgo(daysBack),
    createdAt: isoAtLocalTime(daysAgo(daysBack), 8, 0)
  };
}

function buildProjection(
  id: string,
  products: Product[],
  sales: Sale[],
  orders: Order[],
  expenses: Expense[],
  cashInjectionCents: number
): Projection {
  let seq = 0;
  let lamport = 0;
  const events: LedgerEvent[] = [];
  const deviceId = `bench-${id}`;
  const push = (type: Parameters<typeof createEvent>[0]["type"], payload: Record<string, unknown>, createdAt: string) => {
    seq += 1;
    lamport += 1;
    events.push(createEvent({ deviceId, seq, lamport, type, payload, createdAt }));
  };

  const createdAt = isoAtLocalTime(daysAgo(30), 8, 0);
  for (const item of products) {
    push("product.created", { ...item, stock: 1000, updatedAt: createdAt }, createdAt);
  }
  for (const item of sales) {
    push("sale.completed", item as unknown as Record<string, unknown>, item.createdAt);
  }
  for (const item of expenses) {
    push("expense.recorded", item as unknown as Record<string, unknown>, item.createdAt);
  }
  if (cashInjectionCents > 0) {
    push("payment.recorded", {
      paymentId: `cash-${id}`,
      method: "cash",
      amountCents: cashInjectionCents,
      status: "confirmed",
      businessDate: TODAY,
      createdAt: isoAtLocalTime(TODAY, 8, 0)
    }, isoAtLocalTime(TODAY, 8, 0));
  }
  for (const item of orders) {
    push("order.created", item as unknown as Record<string, unknown>, item.createdAt);
  }

  const projection = project(events);
  for (const item of products) {
    const found = projection.products.find((candidate) => candidate.productId === item.productId);
    if (found) found.stock = item.stock;
  }
  return projection;
}

const rice = product("p-rice", "Rice 5kg", 45000, 34000, 80, 10, 2);
const soap = product("p-soap", "Soap bar", 8500, 6000, 80, 8, 3);
const oil = product("p-oil", "Cooking oil 1L", 32000, 24000, 80, 6, 2);
const milk = product("p-milk", "Milk 500ml", 6500, 5000, 80, 6, 1);
const bread = product("p-bread", "Bread", 7000, 5500, 4, 8, 1);
const breadEdge = product("p-bread-edge", "Bread", 7000, 5500, 9, 8, 1);
const lamp = product("p-lamp", "Slow moving lamp", 120000, 90000, 20, 2, 3);
const cheapLamp = product("p-cheap-lamp", "Slow moving cable", 2000, 1500, 1, 2, 3);
const leakyOil = product("p-leaky-oil", "Cooking oil 1L", 32000, 29000, 80, 6, 2);
const lowDataProduct = product("p-low-data", "Single item", 1000, 900, 5, 2, 2);

function healthySales(product: Product, days: number, perDay: number): Sale[] {
  return Array.from({ length: days }, (_, index) =>
    sale(`s-${product.productId}-${index}`, index, 9 + (index % 4), [[product, perDay]])
  );
}

const healthyProjection = buildProjection(
  "healthy",
  [rice, soap, oil, milk],
  [
    ...healthySales(rice, 14, 2),
    ...healthySales(soap, 14, 2),
    ...healthySales(oil, 14, 1),
    ...healthySales(milk, 14, 2)
  ],
  [],
  [],
  500000
);

const stockoutProjection = buildProjection(
  "stockout",
  [bread],
  [
    sale("s-bread-0", 0, 8, [[bread, 3]]),
    sale("s-bread-1", 1, 8, [[bread, 3]]),
    sale("s-bread-2", 2, 8, [[bread, 3]])
  ],
  [],
  [],
  500000
);

const edgeProjection = buildProjection(
  "stockout-edge",
  [breadEdge],
  [
    sale("s-edge-0", 0, 8, [[breadEdge, 3]]),
    sale("s-edge-1", 1, 8, [[breadEdge, 3]]),
    sale("s-edge-2", 2, 8, [[breadEdge, 3]])
  ],
  [],
  [],
  500000
);

const deadStockProjection = buildProjection(
  "dead-stock",
  [lamp],
  [],
  [],
  [],
  500000
);

const cheapDeadStockProjection = buildProjection(
  "dead-stock-low-value",
  [cheapLamp],
  [],
  [],
  [],
  500000
);

const marginProjection = buildProjection(
  "margin",
  [leakyOil],
  healthySales(leakyOil, 7, 2),
  [],
  [],
  500000
);

const cashGapProjection = buildProjection(
  "cash-gap",
  [rice],
  healthySales(rice, 7, 2),
  [],
  [expense("e-rent", "Rent", 1000000)],
  0
);

const runwayProjection = buildProjection(
  "cash-runway",
  [rice],
  healthySales(rice, 7, 2),
  [],
  [expense("e-costs", "Operating costs", 480000)],
  0
);

const orderProjection = buildProjection(
  "order",
  [rice],
  healthySales(rice, 7, 2),
  [order("o-1", 1, 10, "Wanjiku", [[rice, 1]], "new", "whatsapp")],
  [],
  500000
);

const anomalySales: Sale[] = [];
for (let d = 0; d < 7; d += 1) anomalySales.push(sale(`s-low-${d}`, d, 9, [[rice, 1]]));
for (let d = 7; d < 14; d += 1) anomalySales.push(sale(`s-high-${d}`, d, 9, [[rice, 5]]));
const anomalyProjection = buildProjection("sales-anomaly", [rice], anomalySales, [], [], 500000);

const lowDataProjection = buildProjection("low-data", [lowDataProduct], [], [], [], 500000);

const constrainedProjection = buildProjection(
  "cash-constrained-stockout",
  [bread],
  [
    sale("s-constrained-0", 0, 8, [[bread, 3]]),
    sale("s-constrained-1", 1, 8, [[bread, 3]]),
    sale("s-constrained-2", 2, 8, [[bread, 3]])
  ],
  [],
  [expense("e-constrained-rent", "Rent", 200000)],
  0
);

export const SCENARIOS: Scenario[] = [
  {
    id: "healthy",
    title: "Healthy shop",
    description: "Stock, margin, cash, and orders are all inside their guardrails.",
    projection: healthyProjection,
    gold: { action: "none" }
  },
  {
    id: "stockout",
    title: "Bread stockout",
    description: "Bread has four units left against three sales a day and a one-day lead time.",
    projection: stockoutProjection,
    gold: { action: "reorder", entityId: "p-bread" },
    expectedRule: "stockout-risk"
  },
  {
    id: "stockout-edge",
    title: "Bread at the reorder edge",
    description: "Bread cover is exactly lead time plus safety stock.",
    projection: edgeProjection,
    gold: { action: "reorder", entityId: "p-bread-edge" },
    expectedRule: "stockout-risk"
  },
  {
    id: "cash-constrained-stockout",
    title: "Stockout with no cash",
    description: "Bread is low, but cash is negative and rent is due.",
    projection: constrainedProjection,
    gold: { action: "cash" },
    expectedRule: "cash-gap"
  },
  {
    id: "dead-stock",
    title: "Dead stock",
    description: "A lamp has not sold and is tying up KSh 18,000 of cost.",
    projection: deadStockProjection,
    gold: { action: "discount", entityId: "p-lamp" },
    expectedRule: "dead-stock"
  },
  {
    id: "dead-stock-low-value",
    title: "Low-value dead stock",
    description: "A single cheap cable has not sold; the value is below the action threshold.",
    projection: cheapDeadStockProjection,
    gold: { action: "none" }
  },
  {
    id: "margin-leak",
    title: "Cooking oil margin leak",
    description: "Cooking oil is selling at 9.4% margin versus a 20% target.",
    projection: marginProjection,
    gold: { action: "price", entityId: "p-leaky-oil" },
    expectedRule: "margin-leak"
  },
  {
    id: "cash-gap",
    title: "Cash gap",
    description: "Rent has pushed the cash position below the buffer.",
    projection: cashGapProjection,
    gold: { action: "cash" },
    expectedRule: "cash-gap"
  },
  {
    id: "cash-runway",
    title: "Short cash runway",
    description: "Cash is above the buffer but the runway is under seven days.",
    projection: runwayProjection,
    gold: { action: "cash" },
    expectedRule: "cash-gap"
  },
  {
    id: "order-follow-up",
    title: "Unfulfilled WhatsApp order",
    description: "A paid order has been waiting since yesterday.",
    projection: orderProjection,
    gold: { action: "fulfill", entityId: "o-1" },
    expectedRule: "order-follow-up"
  },
  {
    id: "sales-anomaly",
    title: "Sales anomaly",
    description: "This week is 80% below last week with no stock or cash explanation.",
    projection: anomalyProjection,
    gold: { action: "investigate" },
    expectedRule: "sales-trend"
  },
  {
    id: "low-data",
    title: "Low-data shop",
    description: "One product, no sales history, and nothing clearly actionable.",
    projection: lowDataProjection,
    gold: { action: "none" }
  }
];
