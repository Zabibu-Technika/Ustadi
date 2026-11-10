import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, formatKes, localDate } from "../core/canonical.ts";
import { createEvent, verifyEvent } from "../core/events.ts";
import { FileStore } from "../core/store.ts";
import { seedDemo } from "../core/seed.ts";
import { project, saleTotals, validateSale } from "../core/projection.ts";
import { buildBrief } from "../core/brief.ts";
import { eventsAfter, mergeEvents } from "../core/sync.ts";
import { parseCsv, parseStatement, reconcile } from "../core/reconciliation.ts";
import { generateLicenseKeyPair, licenseStatus, signLicense, verifyLicense, writeLicenseFiles } from "../core/license.ts";
import type { LicensePayload, Sale } from "../core/types.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ustadi-test-"));
}

function withStore(fn: (store: FileStore, dir: string) => void): void {
  const dir = tempDir();
  try {
    fn(new FileStore(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("canonical JSON is stable and key-sorted", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(canonicalJson([{ z: 1, a: 2 }]), '[{"a":2,"z":1}]');
});

test("events hash and detect tampering", () => {
  const event = createEvent({
    deviceId: "dev-test",
    seq: 1,
    lamport: 1,
    type: "stock.adjusted",
    payload: { productId: "p-unga", delta: 1 },
    createdAt: "2026-11-10T08:00:00.000Z"
  });
  assert.equal(verifyEvent(event).ok, true);
  const tampered = { ...event, payload: { productId: "p-unga", delta: 100 } };
  assert.equal(verifyEvent(tampered).ok, false);
});

test("seed projects products, sales, orders, stock and a brief", () => {
  withStore((store) => {
    assert.equal(seedDemo(store), true);
    const projection = project(store.events);
    assert.equal(projection.products.length, 7);
    assert.equal(projection.sales.length, 7);
    assert.equal(projection.orders.length, 3);
    assert.ok(projection.lowStock.some((p) => p.productId === "p-bread"));
    const unga = projection.products.find((p) => p.productId === "p-unga");
    assert.equal(unga?.stock, 20);
    assert.ok(projection.totalSalesCents > 0);
    const brief = buildBrief(projection, localDate());
    assert.equal(brief.metrics.length, 5);
    assert.ok(brief.text.includes("Today"));
    assert.ok(brief.actions.length > 0);
  });
});

test("sale totals and validation catch mismatched payments", () => {
  const lines = [
    { productId: "a", name: "A", qty: 2, unitPriceCents: 1000, unitCostCents: 600 },
    { productId: "b", name: "B", qty: 1, unitPriceCents: 500, unitCostCents: 200 }
  ];
  const totals = saleTotals(lines, 100, 50);
  assert.equal(totals.subtotalCents, 2500);
  assert.equal(totals.totalCents, 2450);
  const sale: Sale = {
    saleId: "sale-test",
    channel: "walk-in",
    lines,
    subtotalCents: totals.subtotalCents,
    discountCents: 100,
    taxCents: 50,
    totalCents: totals.totalCents,
    costCents: totals.costCents,
    payments: [{ method: "cash", amountCents: 2000, status: "confirmed" }],
    businessDate: "2026-11-10",
    createdAt: "2026-11-10T08:00:00.000Z"
  };
  assert.ok(validateSale(sale).some((error) => error.includes("payments")));
  assert.equal(formatKes(2450), "KSh 24.50");
});

test("idempotency prevents duplicate events", () => {
  withStore((store) => {
    const event = store.appendLocal("stock.adjusted", { productId: "p-unga", delta: 1 });
    const result = store.appendRemote({ ...event });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, "duplicate");
  });
});

test("nearby sync merges a ledger and skips duplicates", () => {
  const dirA = tempDir();
  const dirB = tempDir();
  try {
    const a = new FileStore(dirA);
    const b = new FileStore(dirB);
    seedDemo(a);
    const pulled = eventsAfter(a.events, {});
    const first = mergeEvents(b, pulled);
    assert.equal(first.accepted, pulled.length);
    assert.equal(project(b.events).sales.length, 7);
    const second = mergeEvents(b, pulled);
    assert.equal(second.accepted, 0);
    assert.equal(second.skipped, pulled.length);
    const newEvent = b.appendLocal("stock.adjusted", { productId: "p-unga", delta: 2 });
    const back = eventsAfter(b.events, a.vector());
    assert.ok(back.some((event) => event.id === newEvent.id));
    const mergedBack = mergeEvents(a, back);
    assert.ok(mergedBack.accepted >= 1);
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test("CSV parsing and reconciliation match a sale by reference", () => {
  withStore((store) => {
    seedDemo(store);
    const projection = project(store.events);
    const payment = projection.payments.find((item) => item.reference === "MPESA-QK4T2");
    assert.ok(payment);
    const csv = `date,description,amount,reference\n"${payment!.businessDate}","MPESA payment","${(payment!.amountCents / 100).toFixed(2)}","${payment!.reference}"\n`;
    const rows = parseStatement(csv, "mpesa");
    assert.equal(rows.length, 1);
    const result = reconcile(rows, projection);
    assert.equal(result.matched, 1);
    assert.equal(result.unmatched, 0);
    assert.equal(result.rows[0]?.status, "matched");
  });
});

test("CSV parser handles quoted commas", () => {
  const rows = parseCsv('date,description,amount\n2026-11-10,"M-Pesa, shop",100\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.[1], "M-Pesa, shop");
});

test("offline licence signs, verifies, and expires", () => {
  const dir = tempDir();
  try {
    const pair = generateLicenseKeyPair();
    const payload: LicensePayload = {
      licenseId: "lic-test",
      shop: "Test Shop",
      deviceLimit: 3,
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      features: ["counter", "pocket"]
    };
    const license = signLicense(payload, pair.privateKeyPem);
    assert.equal(verifyLicense(license, pair.publicKeyPem), true);
    writeLicenseFiles(dir, license, pair.publicKeyPem);
    const status = licenseStatus(dir, new Date("2026-06-01T00:00:00.000Z"));
    assert.equal(status.mode, "licensed");
    assert.equal(status.shop, "Test Shop");

    const expired: LicensePayload = { ...payload, expiresAt: "2020-01-01T00:00:00.000Z" };
    const expiredLicense = signLicense(expired, pair.privateKeyPem);
    writeLicenseFiles(dir, expiredLicense, pair.publicKeyPem);
    const expiredStatus = licenseStatus(dir, new Date("2026-06-01T00:00:00.000Z"));
    assert.equal(expiredStatus.mode, "expired");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
