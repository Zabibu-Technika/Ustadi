import type { Order } from "../types.ts";
import type { BusinessFacts, DecisionAction, ProductFact } from "./types.ts";

export interface ReorderPlan {
  qty: number;
  targetQty: number;
  costCents: number;
  targetCostCents: number;
  impactCents: number;
  cashConstrained: boolean;
  targetDays: number;
}

export function planReorder(fact: ProductFact, facts: BusinessFacts): ReorderPlan {
  const targetDays = fact.supplierLeadDays + 3;
  const targetUnits = Math.ceil(fact.velocityPerDay * targetDays);
  const need = Math.max(0, targetUnits - fact.stock);
  const cashAvailable = Math.max(0, facts.cashPositionCents - facts.minimumCashCents);
  const affordable = fact.costCents > 0 ? Math.floor(cashAvailable / fact.costCents) : need;
  const qty = Math.min(need, affordable);
  const cashConstrained = qty < need;
  return {
    qty,
    targetQty: need,
    costCents: qty * fact.costCents,
    targetCostCents: need * fact.costCents,
    impactCents: need * Math.max(0, fact.priceCents - fact.costCents),
    cashConstrained,
    targetDays
  };
}

export function reorderAction(fact: ProductFact, plan: ReorderPlan): DecisionAction {
  let label = `Order ${plan.qty} × ${fact.name}`;
  if (plan.cashConstrained) {
    label = plan.qty > 0
      ? `Order ${plan.qty} now · ${plan.targetQty - plan.qty} after cash`
      : `Collect cash first · then order ${plan.targetQty} × ${fact.name}`;
  }
  return {
    type: "reorder",
    label,
    productId: fact.productId,
    qty: plan.qty,
    amountCents: plan.targetCostCents
  };
}

export function discountAction(fact: ProductFact): DecisionAction {
  return {
    type: "discount",
    label: `Bundle or discount ${fact.name} to release stock`,
    productId: fact.productId,
    amountCents: fact.stockValueCents
  };
}

export function marginAction(fact: ProductFact): DecisionAction {
  return {
    type: "price",
    label: `Review ${fact.name}: price, supplier cost, or discounting`,
    productId: fact.productId
  };
}

export function cashAction(facts: BusinessFacts): DecisionAction {
  return {
    type: "cash",
    label: facts.pendingOrdersCount > 0
      ? `Collect ${facts.pendingOrdersCount} pending order${facts.pendingOrdersCount === 1 ? "" : "s"} and delay non-critical purchases`
      : "Delay non-critical purchases and review recurring expenses",
    amountCents: Math.max(0, facts.minimumCashCents - facts.cashPositionCents)
  };
}

export function orderAction(order: Order): DecisionAction {
  return {
    type: "fulfill",
    label: `Fulfil ${order.customerName || "the order"} · ${order.channel}`,
    orderId: order.orderId,
    amountCents: order.totalCents
  };
}
