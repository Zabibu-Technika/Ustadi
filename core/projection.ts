import type {
  DayTotal,
  Expense,
  Order,
  PaymentRecord,
  Product,
  Projection,
  Sale,
  SaleLine,
  SalePayment,
  TopProduct
} from "./types.ts";
import { localDate } from "./canonical.ts";
import { sortEvents } from "./events.ts";

const DEFAULT_LOW_STOCK = 5;

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asSale(payload: Record<string, unknown>): Sale {
  return payload as unknown as Sale;
}

function asProduct(payload: Record<string, unknown>): Product {
  return payload as unknown as Product;
}

export function emptyDay(businessDate: string): DayTotal {
  return {
    businessDate,
    salesCents: 0,
    costCents: 0,
    grossProfitCents: 0,
    discountCents: 0,
    taxCents: 0,
    cashInCents: 0,
    pendingCents: 0,
    expensesCents: 0,
    netCashCents: 0,
    salesCount: 0
  };
}

export function project(events: Parameters<typeof sortEvents>[0]): Projection {
  const products = new Map<string, Product>();
  const sales: Sale[] = [];
  const orders = new Map<string, Order>();
  const payments: PaymentRecord[] = [];
  const expenses: Expense[] = [];
  const salesById = new Map<string, Sale>();

  for (const event of sortEvents(events)) {
    const payload = event.payload;

    if (event.type === "product.created" || event.type === "product.updated") {
      const product = asProduct(payload);
      if (!product.productId) continue;
      const existing = products.get(product.productId);
      products.set(product.productId, {
        ...product,
        stock: asNumber(product.stock, existing?.stock ?? 0),
        lowStockAt: asNumber(product.lowStockAt, existing?.lowStockAt ?? DEFAULT_LOW_STOCK),
        active: product.active !== false,
        updatedAt: event.createdAt
      });
      continue;
    }

    if (event.type === "stock.adjusted") {
      const productId = asString(payload.productId);
      const product = products.get(productId);
      if (product) product.stock += asNumber(payload.delta);
      continue;
    }

    if (event.type === "sale.completed") {
      const sale = asSale(payload);
      if (!sale.saleId) continue;
      sales.push(sale);
      salesById.set(sale.saleId, sale);
      for (const line of sale.lines ?? []) {
        const product = products.get(line.productId);
        if (product) product.stock -= line.qty;
      }
      for (const payment of sale.payments ?? []) {
        payments.push({
          paymentId: `${sale.saleId}-${payment.method}-${payments.length}`,
          saleId: sale.saleId,
          method: payment.method,
          amountCents: payment.amountCents,
          status: payment.status,
          reference: payment.reference,
          businessDate: sale.businessDate,
          createdAt: sale.createdAt
        });
      }
      continue;
    }

    if (event.type === "sale.refunded") {
      const saleId = asString(payload.saleId);
      const sale = salesById.get(saleId);
      if (sale && !sale.refunded) {
        sale.refunded = true;
        for (const line of sale.lines) {
          const product = products.get(line.productId);
          if (product) product.stock += line.qty;
        }
      }
      continue;
    }

    if (event.type === "order.created") {
      const order = payload as unknown as Order;
      if (order.orderId) orders.set(order.orderId, order);
      continue;
    }

    if (event.type === "order.paid" || event.type === "order.fulfilled" || event.type === "order.cancelled") {
      const orderId = asString(payload.orderId);
      const order = orders.get(orderId);
      if (order) {
        order.status = event.type === "order.paid" ? "paid" : event.type === "order.fulfilled" ? "fulfilled" : "cancelled";
      }
      continue;
    }

    if (event.type === "payment.recorded") {
      const payment = payload as unknown as PaymentRecord;
      if (payment.paymentId) payments.push(payment);
      continue;
    }

    if (event.type === "expense.recorded") {
      const expense = payload as unknown as Expense;
      if (expense.expenseId) expenses.push(expense);
      continue;
    }
  }

  const days: Record<string, DayTotal> = {};
  for (const sale of sales) {
    if (sale.refunded) continue;
    const date = sale.businessDate || localDate(sale.createdAt);
    const day = (days[date] ??= emptyDay(date));
    day.salesCents += asNumber(sale.totalCents);
    day.costCents += asNumber(sale.costCents);
    day.discountCents += asNumber(sale.discountCents);
    day.taxCents += asNumber(sale.taxCents);
    day.salesCount += 1;
    for (const payment of sale.payments ?? []) {
      if (payment.status === "confirmed") day.cashInCents += payment.amountCents;
      else day.pendingCents += payment.amountCents;
    }
  }

  for (const expense of expenses) {
    const date = expense.businessDate || localDate(expense.createdAt);
    const day = (days[date] ??= emptyDay(date));
    day.expensesCents += expense.amountCents;
  }

  for (const day of Object.values(days)) {
    day.grossProfitCents = day.salesCents - day.costCents;
    day.netCashCents = day.cashInCents - day.expensesCents;
  }

  const topMap = new Map<string, TopProduct>();
  for (const sale of sales) {
    if (sale.refunded) continue;
    for (const line of sale.lines ?? []) {
      const existing = topMap.get(line.productId) ?? {
        productId: line.productId,
        name: line.name,
        qty: 0,
        revenueCents: 0
      };
      existing.qty += line.qty;
      existing.revenueCents += line.qty * line.unitPriceCents;
      topMap.set(line.productId, existing);
    }
  }

  const productList = [...products.values()].sort((a, b) => a.name.localeCompare(b.name));
  const vector: Record<string, number> = {};
  for (const event of events) vector[event.deviceId] = Math.max(vector[event.deviceId] ?? 0, event.seq);

  const allPayments = payments.filter((p) => p.status === "confirmed" && !salesById.get(p.saleId ?? "")?.refunded);
  const cashPositionCents = allPayments.reduce((sum, p) => sum + p.amountCents, 0) - expenses.reduce((sum, e) => sum + e.amountCents, 0);

  return {
    products: productList,
    sales: [...sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    orders: [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    payments,
    expenses: [...expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    days,
    topProducts: [...topMap.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 5),
    lowStock: productList.filter((p) => p.active && p.stock <= p.lowStockAt),
    pendingOrders: [...orders.values()].filter((o) => o.status === "new" || o.status === "paid"),
    cashPositionCents,
    totalSalesCents: sales.filter((s) => !s.refunded).reduce((sum, s) => sum + s.totalCents, 0),
    vector,
    lastEventAt: events.length ? events[events.length - 1]!.createdAt : null
  };
}

export function saleTotals(lines: SaleLine[], discountCents = 0, taxCents = 0): {
  subtotalCents: number;
  costCents: number;
  totalCents: number;
} {
  const subtotalCents = lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0);
  const costCents = lines.reduce((sum, line) => sum + line.qty * line.unitCostCents, 0);
  return { subtotalCents, costCents, totalCents: subtotalCents - discountCents + taxCents };
}

export function validateSale(sale: Sale): string[] {
  const errors: string[] = [];
  if (!sale.saleId) errors.push("saleId is required");
  if (!Array.isArray(sale.lines) || sale.lines.length === 0) errors.push("at least one line is required");
  for (const line of sale.lines ?? []) {
    if (!line.productId) errors.push("line.productId is required");
    if (!Number.isInteger(line.qty) || line.qty <= 0) errors.push(`invalid qty for ${line.productId}`);
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) errors.push(`invalid price for ${line.productId}`);
    if (!Number.isInteger(line.unitCostCents) || line.unitCostCents < 0) errors.push(`invalid cost for ${line.productId}`);
  }
  const expected = saleTotals(sale.lines ?? [], sale.discountCents, sale.taxCents);
  if (expected.subtotalCents !== sale.subtotalCents) errors.push("subtotal does not match lines");
  if (expected.totalCents !== sale.totalCents) errors.push("total does not match subtotal, discount, and tax");
  if (expected.costCents !== sale.costCents) errors.push("cost does not match lines");
  const paid = (sale.payments ?? []).reduce((sum, p) => sum + p.amountCents, 0);
  if (paid !== sale.totalCents) errors.push("payments do not equal total");
  for (const payment of sale.payments ?? []) {
    if (!["cash", "mpesa", "card"].includes(payment.method)) errors.push(`invalid payment method ${payment.method}`);
    if (!["confirmed", "pending"].includes(payment.status)) errors.push(`invalid payment status ${payment.status}`);
  }
  if (!sale.channel) errors.push("channel is required");
  if (!sale.businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(sale.businessDate)) errors.push("businessDate must be YYYY-MM-DD");
  return errors;
}

export function validateProduct(product: Product): string[] {
  const errors: string[] = [];
  if (!product.productId) errors.push("productId is required");
  if (!product.name) errors.push("name is required");
  if (!Number.isInteger(product.priceCents) || product.priceCents < 0) errors.push("priceCents must be a positive integer");
  if (!Number.isInteger(product.costCents) || product.costCents < 0) errors.push("costCents must be a positive integer");
  if (!Number.isInteger(product.stock) || product.stock < 0) errors.push("stock must be a non-negative integer");
  return errors;
}

export function paymentTotal(payments: SalePayment[]): number {
  return payments.reduce((sum, p) => sum + p.amountCents, 0);
}
