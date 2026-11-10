import { FileStore } from "./store.ts";
import { daysAgo, isoAtLocalTime } from "./canonical.ts";
import type { Expense, Order, Product, Sale, SaleLine } from "./types.ts";
import { saleTotals } from "./projection.ts";

const PRODUCTS: Product[] = [
  { productId: "p-unga", name: "Unga 2kg", sku: "UNGA-2", priceCents: 18000, costCents: 15500, stock: 24, lowStockAt: 6, active: true, updatedAt: "" },
  { productId: "p-milk", name: "Milk 500ml", sku: "MILK-5", priceCents: 6500, costCents: 5200, stock: 18, lowStockAt: 6, active: true, updatedAt: "" },
  { productId: "p-sugar", name: "Sugar 1kg", sku: "SUGAR-1", priceCents: 16000, costCents: 14000, stock: 12, lowStockAt: 5, active: true, updatedAt: "" },
  { productId: "p-oil", name: "Cooking oil 1L", sku: "OIL-1", priceCents: 32000, costCents: 28500, stock: 8, lowStockAt: 4, active: true, updatedAt: "" },
  { productId: "p-soap", name: "Soap bar", sku: "SOAP-1", priceCents: 8500, costCents: 6800, stock: 30, lowStockAt: 8, active: true, updatedAt: "" },
  { productId: "p-bread", name: "Bread", sku: "BREAD-1", priceCents: 7000, costCents: 5500, stock: 12, lowStockAt: 8, active: true, updatedAt: "" },
  { productId: "p-eggs", name: "Eggs tray", sku: "EGGS-30", priceCents: 42000, costCents: 37000, stock: 4, lowStockAt: 5, active: true, updatedAt: "" }
];

function line(productId: string, qty: number): SaleLine {
  const product = PRODUCTS.find((item) => item.productId === productId)!;
  return {
    productId,
    name: product.name,
    qty,
    unitPriceCents: product.priceCents,
    unitCostCents: product.costCents
  };
}

function makeSale(input: {
  saleId: string;
  channel: Sale["channel"];
  lines: SaleLine[];
  method: "cash" | "mpesa" | "card";
  status: "confirmed" | "pending";
  reference?: string;
  date: string;
  createdAt: string;
  customerName?: string;
  customerPhone?: string;
}): Sale {
  const totals = saleTotals(input.lines, 0, 0);
  return {
    saleId: input.saleId,
    channel: input.channel,
    lines: input.lines,
    subtotalCents: totals.subtotalCents,
    discountCents: 0,
    taxCents: 0,
    totalCents: totals.totalCents,
    costCents: totals.costCents,
    payments: [{ method: input.method, amountCents: totals.totalCents, status: input.status, reference: input.reference }],
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    businessDate: input.date,
    createdAt: input.createdAt
  };
}

export function seedDemo(store: FileStore, force = false): boolean {
  if (!force && store.events.length > 0) return false;
  const today = daysAgo(0);
  const yesterday = daysAgo(1);
  const twoDays = daysAgo(2);
  const weekAgo = daysAgo(7);

  for (const product of PRODUCTS) {
    store.appendLocal("product.created", product as unknown as Record<string, unknown>, {
      createdAt: isoAtLocalTime(weekAgo, 8, 0)
    });
  }

  const sales: Sale[] = [
    makeSale({ saleId: "s-1", channel: "walk-in", lines: [line("p-unga", 2), line("p-milk", 1)], method: "cash", status: "confirmed", date: today, createdAt: isoAtLocalTime(today, 8, 30) }),
    makeSale({ saleId: "s-2", channel: "walk-in", lines: [line("p-oil", 1), line("p-soap", 2)], method: "mpesa", status: "confirmed", reference: "MPESA-QK4T2", date: today, createdAt: isoAtLocalTime(today, 10, 15) }),
    makeSale({ saleId: "s-3", channel: "whatsapp", lines: [line("p-bread", 3), line("p-milk", 2)], method: "mpesa", status: "pending", reference: "MPESA-PENDING-1", date: today, createdAt: isoAtLocalTime(today, 12, 40), customerName: "Wanjiku", customerPhone: "0712 000 111" }),
    makeSale({ saleId: "s-4", channel: "walk-in", lines: [line("p-unga", 1), line("p-sugar", 2), line("p-milk", 1)], method: "cash", status: "confirmed", date: yesterday, createdAt: isoAtLocalTime(yesterday, 9, 10) }),
    makeSale({ saleId: "s-5", channel: "online", lines: [line("p-oil", 2), line("p-soap", 1)], method: "mpesa", status: "confirmed", reference: "MPESA-8ZX9L", date: yesterday, createdAt: isoAtLocalTime(yesterday, 15, 30), customerName: "Brian" }),
    makeSale({ saleId: "s-6", channel: "walk-in", lines: [line("p-bread", 4), line("p-milk", 3)], method: "cash", status: "confirmed", date: twoDays, createdAt: isoAtLocalTime(twoDays, 11, 0) }),
    makeSale({ saleId: "s-7", channel: "phone", lines: [line("p-eggs", 1), line("p-unga", 1)], method: "mpesa", status: "confirmed", reference: "MPESA-44PLQ", date: twoDays, createdAt: isoAtLocalTime(twoDays, 16, 20), customerName: "Amina" })
  ];
  for (const sale of sales) store.appendLocal("sale.completed", sale as unknown as Record<string, unknown>, { createdAt: sale.createdAt });

  const orders: Order[] = [
    { orderId: "o-1", channel: "whatsapp", customerName: "Wanjiku", customerPhone: "0712 000 111", lines: [line("p-eggs", 1), line("p-bread", 2)], totalCents: 56000, status: "new", createdAt: isoAtLocalTime(today, 11, 20), note: "Deliver to shop before 5pm." },
    { orderId: "o-2", channel: "instagram", customerName: "Brian", customerPhone: "0722 333 444", lines: [line("p-unga", 1), line("p-oil", 1)], totalCents: 50000, status: "paid", createdAt: isoAtLocalTime(today, 9, 50), note: "Paid via M-Pesa; pickup." },
    { orderId: "o-3", channel: "phone", customerName: "Amina", customerPhone: "0733 555 666", lines: [line("p-milk", 2), line("p-soap", 1)], totalCents: 21500, status: "new", createdAt: isoAtLocalTime(yesterday, 17, 0), note: "Call before delivery." }
  ];
  for (const order of orders) store.appendLocal("order.created", order as unknown as Record<string, unknown>, { createdAt: order.createdAt });

  const expenses: Expense[] = [
    { expenseId: "e-1", category: "Rent", amountCents: 1500000, note: "November shop rent", businessDate: yesterday, createdAt: isoAtLocalTime(yesterday, 8, 0) },
    { expenseId: "e-2", category: "Transport", amountCents: 30000, note: "Stock pickup", businessDate: today, createdAt: isoAtLocalTime(today, 7, 45) },
    { expenseId: "e-3", category: "Electricity", amountCents: 120000, note: "Token", businessDate: twoDays, createdAt: isoAtLocalTime(twoDays, 9, 0) },
    { expenseId: "e-4", category: "Packaging", amountCents: 45000, note: "Paper bags", businessDate: today, createdAt: isoAtLocalTime(today, 13, 10) }
  ];
  for (const expense of expenses) store.appendLocal("expense.recorded", expense as unknown as Record<string, unknown>, { createdAt: expense.createdAt });

  return true;
}
