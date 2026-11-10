import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { FileStore } from "../../core/store.ts";
import { buildBrief } from "../../core/brief.ts";
import { licenseStatus } from "../../core/license.ts";
import { parseStatement, reconcile } from "../../core/reconciliation.ts";
import { seedDemo } from "../../core/seed.ts";
import { eventsAfter, mergeEvents, syncWithPeer } from "../../core/sync.ts";
import { project, saleTotals, validateProduct, validateSale } from "../../core/projection.ts";
import { generateIntelligence } from "../../core/intelligence/engine.ts";
import { findTool } from "../../core/intelligence/tools.ts";
import { formatKes, localDate, randomId } from "../../core/canonical.ts";
import type { LedgerEvent, Order, Product, Sale, SaleChannel, SaleLine, SalePayment } from "../../core/types.ts";
import type { IncomingHttpHeaders } from "node:http";

const here = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = resolve(here, "public");
const DATA_DIR = resolve(process.env.USTADI_DATA ?? join(process.cwd(), "data"));
const PORT = Number(process.env.USTADI_PORT ?? 4173);
const HOST = process.env.USTADI_HOST ?? "0.0.0.0";

const store = new FileStore(DATA_DIR);
const seeded = process.env.USTADI_SEED === "0" ? false : seedDemo(store);
const clients = new Set<ServerResponse>();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function lanUrls(): string[] {
  const urls: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) urls.push(`http://${entry.address}:${PORT}`);
    }
  }
  return urls;
}

function state() {
  const projection = project(store.events);
  const intelligence = generateIntelligence(projection, store.events);
  return {
    meta: {
      ...store.meta,
      lanUrls: lanUrls(),
      dataDir: DATA_DIR,
      seeded
    },
    projection,
    brief: buildBrief(projection),
    intelligence,
    license: licenseStatus(DATA_DIR),
    vector: store.vector(),
    serverTime: new Date().toISOString(),
    currency: "KES"
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-ustadi-pair",
    "access-control-allow-methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString("utf8");
    if (raw.length > 2_000_000) throw new Error("body too large");
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("invalid JSON");
  }
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function requirePair(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const code = header(req.headers, "x-ustadi-pair") || url.searchParams.get("code") || "";
  if (code.toUpperCase() !== store.meta.pairingCode.toUpperCase()) {
    json(res, 401, { error: "pairing code required" });
    return false;
  }
  return true;
}

function broadcast(): void {
  const payload = `data: ${JSON.stringify({ type: "state", at: new Date().toISOString() })}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

function sendFile(res: ServerResponse, urlPath: string): void {
  const clean = urlPath === "/" ? "/index.html" : urlPath;
  const target = resolve(PUBLIC_DIR, "." + clean);
  if (!target.startsWith(PUBLIC_DIR) || !existsSync(target)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const ext = extname(target).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const cache = ext === ".html" || ext === ".js" || ext === ".css" ? "no-store" : "public, max-age=3600";
  res.writeHead(200, { "content-type": mime, "cache-control": cache });
  res.end(readFileSync(target));
}

function buildSale(input: Record<string, unknown>): Sale {
  const projection = project(store.events);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const lines: SaleLine[] = rawLines.map((raw) => {
    const item = raw as Record<string, unknown>;
    const product = projection.products.find((candidate) => candidate.productId === item.productId);
    if (!product) throw new Error(`unknown product: ${String(item.productId)}`);
    const qty = Number(item.qty ?? 1);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error(`invalid qty for ${product.name}`);
    return {
      productId: product.productId,
      name: product.name,
      qty,
      unitPriceCents: product.priceCents,
      unitCostCents: product.costCents
    };
  });
  const discountCents = Number(input.discountCents ?? 0);
  const taxCents = Number(input.taxCents ?? 0);
  const totals = saleTotals(lines, discountCents, taxCents);
  const demand = new Map<string, number>();
  for (const line of lines) demand.set(line.productId, (demand.get(line.productId) ?? 0) + line.qty);
  for (const [productId, qty] of demand) {
    const product = projection.products.find((candidate) => candidate.productId === productId);
    if (!product) throw new Error(`unknown product: ${productId}`);
    if (qty > product.stock) throw new Error(`Not enough stock for ${product.name}: ${product.stock} left.`);
  }
  const method = String(input.method ?? "cash") as SalePayment["method"];
  const status = String(input.status ?? "confirmed") as SalePayment["status"];
  const payment: SalePayment = {
    method,
    amountCents: totals.totalCents,
    status,
    reference: typeof input.reference === "string" ? input.reference : undefined
  };
  const sale: Sale = {
    saleId: randomId("sale-"),
    channel: String(input.channel ?? "walk-in") as SaleChannel,
    lines,
    subtotalCents: totals.subtotalCents,
    discountCents,
    taxCents,
    totalCents: totals.totalCents,
    costCents: totals.costCents,
    payments: [payment],
    customerName: typeof input.customerName === "string" ? input.customerName : undefined,
    customerPhone: typeof input.customerPhone === "string" ? input.customerPhone : undefined,
    businessDate: typeof input.businessDate === "string" ? input.businessDate : localDate(),
    createdAt: new Date().toISOString(),
    orderId: typeof input.orderId === "string" ? input.orderId : undefined
  };
  const errors = validateSale(sale);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return sale;
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  if (path === "/api/health") {
    json(res, 200, { ok: true, deviceId: store.meta.deviceId, dataDir: DATA_DIR, seeded });
    return;
  }

  if (path === "/api/state") {
    json(res, 200, state());
    return;
  }

  if (path === "/api/brief") {
    const projection = project(store.events);
    json(res, 200, buildBrief(projection));
    return;
  }

  if (path === "/api/license") {
    json(res, 200, licenseStatus(DATA_DIR));
    return;
  }

  if (path === "/api/backup" && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ustadi-backup-${localDate()}.json"`,
      "cache-control": "no-store"
    });
    res.end(JSON.stringify(store.backup(), null, 2));
    return;
  }

  if (path === "/api/products" && req.method === "POST") {
    const input = await body(req);
    const projection = project(store.events);
    const license = licenseStatus(DATA_DIR);
    const existing = typeof input.productId === "string" ? projection.products.find((p) => p.productId === input.productId) : undefined;
    if (!existing && license.mode !== "licensed" && projection.products.length >= 25) {
      json(res, 403, { error: "Community mode is limited to 25 products. Install a licence for more." });
      return;
    }
    const product: Product = {
      productId: existing?.productId ?? randomId("prod-"),
      name: String(input.name ?? "").trim(),
      sku: String(input.sku ?? "").trim(),
      priceCents: Number(input.priceCents ?? 0),
      costCents: Number(input.costCents ?? 0),
      stock: Number(input.stock ?? 0),
      lowStockAt: Number(input.lowStockAt ?? 5),
      active: input.active !== false,
      updatedAt: new Date().toISOString(),
      supplierLeadDays: Number(input.supplierLeadDays ?? existing?.supplierLeadDays ?? 2)
    };
    const errors = validateProduct(product);
    if (!product.name) errors.push("name is required");
    if (errors.length > 0) {
      json(res, 400, { error: errors.join("; ") });
      return;
    }
    store.appendLocal(existing ? "product.updated" : "product.created", product as unknown as Record<string, unknown>);
    broadcast();
    json(res, 200, state());
    return;
  }

  if (path === "/api/stock" && req.method === "POST") {
    const input = await body(req);
    const productId = String(input.productId ?? "");
    const delta = Number(input.delta ?? 0);
    if (!productId || !Number.isInteger(delta) || delta === 0) {
      json(res, 400, { error: "productId and a non-zero integer delta are required" });
      return;
    }
    store.appendLocal("stock.adjusted", { productId, delta, reason: String(input.reason ?? "manual") });
    broadcast();
    json(res, 200, state());
    return;
  }

  if (path === "/api/sales" && req.method === "POST") {
    const input = await body(req);
    try {
      const sale = buildSale(input);
      store.appendLocal("sale.completed", sale as unknown as Record<string, unknown>);
      if (sale.orderId) {
        const order = project(store.events).orders.find((item) => item.orderId === sale.orderId);
        if (order && order.status !== "fulfilled") {
          store.appendLocal("order.fulfilled", { orderId: order.orderId });
        }
      }
      broadcast();
      json(res, 200, state());
    } catch (error) {
      json(res, 400, { error: (error as Error).message });
    }
    return;
  }

  if (path === "/api/orders" && req.method === "POST") {
    const input = await body(req);
    const projection = project(store.events);
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    const lines = rawLines.map((raw) => {
      const item = raw as Record<string, unknown>;
      const product = projection.products.find((candidate) => candidate.productId === item.productId);
      if (!product) throw new Error(`unknown product: ${String(item.productId)}`);
      const qty = Number(item.qty ?? 1);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error(`invalid qty for ${product.name}`);
      return {
        productId: product.productId,
        name: product.name,
        qty,
        unitPriceCents: product.priceCents,
        unitCostCents: product.costCents
      };
    });
    const order: Order = {
      orderId: randomId("order-"),
      channel: String(input.channel ?? "whatsapp") as SaleChannel,
      customerName: String(input.customerName ?? "Walk-in").trim(),
      customerPhone: typeof input.customerPhone === "string" ? input.customerPhone : undefined,
      lines,
      totalCents: lines.reduce((sum, line) => sum + line.qty * line.unitPriceCents, 0),
      status: "new",
      createdAt: new Date().toISOString(),
      note: typeof input.note === "string" ? input.note : undefined
    };
    if (lines.length === 0) {
      json(res, 400, { error: "at least one line is required" });
      return;
    }
    store.appendLocal("order.created", order as unknown as Record<string, unknown>);
    broadcast();
    json(res, 200, state());
    return;
  }

  const orderPay = /^\/api\/orders\/([^/]+)\/pay$/.exec(path);
  if (orderPay && req.method === "POST") {
    const orderId = decodeURIComponent(orderPay[1]!);
    const projection = project(store.events);
    const order = projection.orders.find((item) => item.orderId === orderId);
    if (!order) {
      json(res, 404, { error: "order not found" });
      return;
    }
    store.appendLocal("order.paid", { orderId });
    broadcast();
    json(res, 200, state());
    return;
  }

  const orderFulfill = /^\/api\/orders\/([^/]+)\/fulfill$/.exec(path);
  if (orderFulfill && req.method === "POST") {
    const orderId = decodeURIComponent(orderFulfill[1]!);
    const input = await body(req);
    const projection = project(store.events);
    const order = projection.orders.find((item) => item.orderId === orderId);
    if (!order) {
      json(res, 404, { error: "order not found" });
      return;
    }
    if (order.status === "fulfilled") {
      json(res, 400, { error: "order already fulfilled" });
      return;
    }
    try {
      const sale = buildSale({
        channel: order.channel,
        lines: order.lines.map((line) => ({ productId: line.productId, qty: line.qty })),
        method: input.method ?? "mpesa",
        status: input.status ?? "confirmed",
        reference: input.reference,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        orderId
      });
      store.appendLocal("sale.completed", sale as unknown as Record<string, unknown>);
      store.appendLocal("order.fulfilled", { orderId });
      broadcast();
      json(res, 200, state());
    } catch (error) {
      json(res, 400, { error: (error as Error).message });
    }
    return;
  }

  if (path === "/api/expenses" && req.method === "POST") {
    const input = await body(req);
    const expense = {
      expenseId: randomId("exp-"),
      category: String(input.category ?? "Other").trim() || "Other",
      amountCents: Number(input.amountCents ?? 0),
      note: String(input.note ?? ""),
      businessDate: String(input.businessDate ?? localDate()),
      createdAt: new Date().toISOString()
    };
    if (!Number.isInteger(expense.amountCents) || expense.amountCents <= 0) {
      json(res, 400, { error: "amountCents must be a positive integer" });
      return;
    }
    store.appendLocal("expense.recorded", expense);
    broadcast();
    json(res, 200, state());
    return;
  }

  if (path === "/api/reconcile" && req.method === "POST") {
    const input = await body(req);
    const csv = String(input.csv ?? "");
    const method = String(input.method ?? "mpesa") as "cash" | "mpesa" | "card";
    const rows = parseStatement(csv, method);
    const projection = project(store.events);
    json(res, 200, { ...reconcile(rows, projection) });
    return;
  }

  if (path === "/api/intelligence" && req.method === "GET") {
    const projection = project(store.events);
    json(res, 200, generateIntelligence(projection, store.events));
    return;
  }

  const decisionRoute = /^\/api\/decisions\/([^/]+)$/.exec(path);
  if (decisionRoute && req.method === "POST") {
    const decisionId = decodeURIComponent(decisionRoute[1]!);
    const input = await body(req);
    const status = String(input.status ?? "");
    if (!["approved", "dismissed", "done"].includes(status)) {
      json(res, 400, { error: "status must be approved, dismissed, or done" });
      return;
    }
    const projection = project(store.events);
    const intelligence = generateIntelligence(projection, store.events);
    const decision = intelligence.decisions.find((item) => item.decisionId === decisionId);
    if (!decision) {
      json(res, 404, { error: "decision not found or already closed" });
      return;
    }
    store.appendLocal("decision.recorded", {
      decisionId,
      ruleId: decision.ruleId,
      status,
      note: typeof input.note === "string" ? input.note : "",
      at: new Date().toISOString()
    });
    broadcast();
    json(res, 200, state());
    return;
  }

  if (path === "/api/intelligence/run" && req.method === "POST") {
    const projection = project(store.events);
    const intelligence = generateIntelligence(projection, store.events);
    broadcast();
    json(res, 200, intelligence);
    return;
  }

  const toolRoute = /^\/api\/tools\/([^/]+)$/.exec(path);
  if (toolRoute && req.method === "POST") {
    const toolId = decodeURIComponent(toolRoute[1]!);
    const tool = findTool(toolId);
    if (!tool) {
      json(res, 404, { error: "unknown tool" });
      return;
    }
    const input = await body(req);
    if (tool.mutating && input.approved !== true) {
      json(res, 403, { error: "this tool mutates the ledger and requires approval: true" });
      return;
    }

    if (tool.id === "draft_message") {
      json(res, 200, { ok: true, tool: tool.id, text: String(input.text ?? "") });
      return;
    }

    if (tool.id === "record_decision") {
      const decisionId = String(input.decisionId ?? "");
      const status = String(input.status ?? "approved");
      if (!decisionId || !["approved", "dismissed", "done"].includes(status)) {
        json(res, 400, { error: "decisionId and a valid status are required" });
        return;
      }
      const intelligence = generateIntelligence(project(store.events), store.events);
      const decision = intelligence.decisions.find((item) => item.decisionId === decisionId);
      if (!decision) {
        json(res, 404, { error: "decision not found or already closed" });
        return;
      }
      store.appendLocal("decision.recorded", {
        decisionId,
        ruleId: decision.ruleId,
        status,
        note: String(input.note ?? ""),
        at: new Date().toISOString()
      });
      broadcast();
      json(res, 200, { ok: true, tool: tool.id, state: state() });
      return;
    }

    if (tool.id === "fulfill_order") {
      const orderId = String(input.orderId ?? "");
      const projection = project(store.events);
      const order = projection.orders.find((item) => item.orderId === orderId);
      if (!order) {
        json(res, 404, { error: "order not found" });
        return;
      }
      if (order.status === "fulfilled") {
        json(res, 400, { error: "order already fulfilled" });
        return;
      }
      try {
        const sale = buildSale({
          channel: order.channel,
          lines: order.lines.map((line) => ({ productId: line.productId, qty: line.qty })),
          method: input.method ?? "mpesa",
          status: input.status ?? "confirmed",
          reference: input.reference,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          orderId
        });
        store.appendLocal("sale.completed", sale as unknown as Record<string, unknown>);
        store.appendLocal("order.fulfilled", { orderId });
        if (typeof input.decisionId === "string" && input.decisionId) {
          store.appendLocal("decision.recorded", {
            decisionId: input.decisionId,
            ruleId: "order-follow-up",
            status: "done",
            note: "fulfilled by tool",
            at: new Date().toISOString()
          });
        }
        broadcast();
        json(res, 200, { ok: true, tool: tool.id, sale, state: state() });
      } catch (error) {
        json(res, 400, { error: (error as Error).message });
      }
      return;
    }

    if (tool.id === "adjust_stock") {
      const productId = String(input.productId ?? "");
      const delta = Number(input.delta ?? 0);
      if (!productId || !Number.isInteger(delta) || delta === 0) {
        json(res, 400, { error: "productId and a non-zero integer delta are required" });
        return;
      }
      store.appendLocal("stock.adjusted", { productId, delta, reason: String(input.reason ?? "tool") });
      broadcast();
      json(res, 200, { ok: true, tool: tool.id, state: state() });
      return;
    }

    if (tool.id === "record_expense") {
      const amountCents = Number(input.amountCents ?? 0);
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        json(res, 400, { error: "amountCents must be a positive integer" });
        return;
      }
      store.appendLocal("expense.recorded", {
        expenseId: randomId("exp-"),
        category: String(input.category ?? "Other"),
        amountCents,
        note: String(input.note ?? ""),
        businessDate: String(input.businessDate ?? localDate()),
        createdAt: new Date().toISOString()
      });
      broadcast();
      json(res, 200, { ok: true, tool: tool.id, state: state() });
      return;
    }

    json(res, 400, { error: "tool is not enabled" });
    return;
  }

  if (path === "/api/sync/state" && req.method === "GET") {
    if (!requirePair(req, res, url)) return;
    json(res, 200, { deviceId: store.meta.deviceId, vector: store.vector(), serverTime: new Date().toISOString() });
    return;
  }

  if (path === "/api/sync/pull" && req.method === "POST") {
    if (!requirePair(req, res, url)) return;
    const input = await body(req);
    const vector = (input.vector ?? {}) as Record<string, number>;
    json(res, 200, { events: eventsAfter(store.events, vector).slice(0, 5000) });
    return;
  }

  if (path === "/api/sync/push" && req.method === "POST") {
    if (!requirePair(req, res, url)) return;
    const input = await body(req);
    const events = Array.isArray(input.events) ? (input.events as LedgerEvent[]) : [];
    const result = mergeEvents(store, events);
    if (result.accepted > 0) broadcast();
    json(res, 200, result);
    return;
  }

  if (path === "/api/sync/peer" && req.method === "POST") {
    const input = await body(req);
    const peerUrl = String(input.url ?? "").trim();
    const peerCode = String(input.code ?? "").trim();
    if (!peerUrl || !peerCode) {
      json(res, 400, { error: "url and code are required" });
      return;
    }
    try {
      const result = await syncWithPeer(store, peerUrl, peerCode);
      broadcast();
      json(res, 200, { ok: true, ...result, state: state() });
    } catch (error) {
      json(res, 502, { error: (error as Error).message });
    }
    return;
  }

  if (path === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*"
    });
    res.write(`data: ${JSON.stringify({ type: "hello", deviceId: store.meta.deviceId })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (path.startsWith("/api/")) {
    json(res, 404, { error: "unknown api route" });
    return;
  }

  sendFile(res, path);
}

const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: (error as Error).message });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  const urls = lanUrls();
  console.log("");
  console.log("  USTADI COUNTER");
  console.log("  ──────────────────────────────────────────");
  console.log(`  Local     http://localhost:${PORT}`);
  for (const url of urls) console.log(`  Nearby    ${url}`);
  console.log(`  Pair code ${store.meta.pairingCode}`);
  console.log(`  Device    ${store.meta.deviceName}`);
  console.log(`  Data      ${DATA_DIR}`);
  console.log(`  Licence   ${licenseStatus(DATA_DIR).message}`);
  console.log("");
  console.log(`  Pocket    http://localhost:${PORT}/pocket.html`);
  console.log("  Your data stays on this machine. Sync is peer-to-peer on the local network.");
  console.log("");
});

const heartbeat = setInterval(() => {
  if (clients.size > 0) broadcast();
}, 5 * 60 * 1000);
heartbeat.unref?.();

process.on("SIGINT", () => {
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
});
