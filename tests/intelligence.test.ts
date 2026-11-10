import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../core/store.ts";
import { seedDemo } from "../core/seed.ts";
import { project } from "../core/projection.ts";
import { generateIntelligence } from "../core/intelligence/engine.ts";
import type { Product } from "../core/types.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ustadi-intel-"));
}

function withStore(fn: (store: FileStore, dir: string) => void): void {
  const dir = tempDir();
  try {
    fn(new FileStore(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("intelligence generates typed decisions with evidence, confidence and triggers", () => {
  withStore((store) => {
    seedDemo(store);
    const projection = project(store.events);
    const intelligence = generateIntelligence(projection, store.events);
    assert.ok(intelligence.decisions.length >= 3);
    assert.equal(intelligence.tools.length, 5);
    assert.equal(intelligence.proactive.heartbeatSeconds, 300);
    assert.ok(intelligence.proactive.triggers.length >= 5);
    for (const decision of intelligence.decisions) {
      assert.ok(decision.decisionId);
      assert.ok(decision.ruleId);
      assert.ok(decision.trigger);
      assert.ok(decision.evidence.length > 0);
      assert.ok(decision.confidence >= 0 && decision.confidence <= 1);
      assert.ok(decision.impactCents >= 0);
    }
  });
});

test("stockout, margin, cash and order rules fire on the demo ledger", () => {
  withStore((store) => {
    seedDemo(store);
    const intelligence = generateIntelligence(project(store.events), store.events);
    const rules = new Set(intelligence.decisions.map((decision) => decision.ruleId));
    assert.ok(rules.has("stockout-risk"));
    assert.ok(rules.has("margin-leak"));
    assert.ok(rules.has("cash-gap"));
    assert.ok(rules.has("order-follow-up"));
    const bread = intelligence.decisions.find((decision) => decision.ruleId === "stockout-risk" && decision.entityId === "p-bread");
    assert.ok(bread);
    assert.equal(bread?.action.type, "reorder");
    assert.ok((bread?.impactCents ?? 0) > 0);
    assert.ok((bread?.action.label ?? "").includes("Bread"));
    const order = intelligence.decisions.find((decision) => decision.ruleId === "order-follow-up");
    assert.ok(order?.draft?.text.includes("Ustadi order"));
  });
});

test("facts expose velocity and stock cover", () => {
  withStore((store) => {
    seedDemo(store);
    const intelligence = generateIntelligence(project(store.events), store.events);
    const bread = intelligence.facts.products.find((product) => product.productId === "p-bread");
    assert.ok(bread);
    assert.ok((bread?.velocityPerDay ?? 0) > 0);
    assert.ok((bread?.stockCoverDays ?? 0) > 0);
    assert.ok(intelligence.facts.dataQuality > 0.5);
    assert.ok(intelligence.facts.pendingOrdersCount > 0);
  });
});

test("dismissed decisions leave the inbox; approved decisions stay approved", () => {
  withStore((store) => {
    seedDemo(store);
    const first = generateIntelligence(project(store.events), store.events);
    const stockout = first.decisions.find((decision) => decision.ruleId === "stockout-risk");
    const order = first.decisions.find((decision) => decision.ruleId === "order-follow-up");
    assert.ok(stockout);
    assert.ok(order);

    store.appendLocal("decision.recorded", {
      decisionId: stockout!.decisionId,
      ruleId: stockout!.ruleId,
      status: "dismissed",
      at: new Date().toISOString()
    });
    store.appendLocal("decision.recorded", {
      decisionId: order!.decisionId,
      ruleId: order!.ruleId,
      status: "approved",
      at: new Date().toISOString()
    });

    const second = generateIntelligence(project(store.events), store.events);
    assert.equal(second.decisions.some((decision) => decision.decisionId === stockout!.decisionId), false);
    const approved = second.decisions.find((decision) => decision.decisionId === order!.decisionId);
    assert.equal(approved?.status, "approved");
  });
});

test("dead stock is detected for a product with no sales", () => {
  withStore((store) => {
    seedDemo(store);
    const product: Product = {
      productId: "p-dead",
      name: "Slow moving lamp",
      sku: "LAMP-1",
      priceCents: 120000,
      costCents: 90000,
      stock: 10,
      lowStockAt: 2,
      active: true,
      updatedAt: new Date().toISOString(),
      supplierLeadDays: 3
    };
    store.appendLocal("product.created", product as unknown as Record<string, unknown>);
    const intelligence = generateIntelligence(project(store.events), store.events);
    const dead = intelligence.decisions.find((decision) => decision.ruleId === "dead-stock" && decision.entityId === "p-dead");
    assert.ok(dead);
    assert.equal(dead?.action.type, "discount");
    assert.ok((dead?.impactCents ?? 0) >= 900000);
  });
});
