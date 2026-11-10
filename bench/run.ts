import { writeFileSync } from "node:fs";
import { generateIntelligence } from "../core/intelligence/engine.ts";
import type { BusinessDecision } from "../core/intelligence/types.ts";
import { SCENARIOS, type GoldAction, type Scenario } from "./scenarios.ts";

const MODEL = process.env.BENCH_MODEL ?? "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const INPUT_USD_PER_M = 0.15;
const OUTPUT_USD_PER_M = 0.75;
const ALLOWED: GoldAction[] = ["reorder", "discount", "price", "fulfill", "cash", "investigate", "none"];

interface Prediction {
  action: GoldAction;
  entityId?: string;
  qty?: number;
  confidence: number;
  reason: string;
}

interface EngineResult {
  prediction: Prediction;
  correct: boolean;
  actionable: boolean;
  latencyMs: number;
  costUsd: number;
  error?: string;
}

interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface LlmResult extends EngineResult {
  usage?: LlmUsage;
  parseError?: string;
  valid: boolean;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function correct(scenario: Scenario, prediction: Prediction): boolean {
  if (scenario.gold.action === "none") return prediction.action === "none";
  if (prediction.action !== scenario.gold.action) return false;
  if (["reorder", "discount", "price", "fulfill"].includes(scenario.gold.action)) {
    return prediction.entityId === scenario.gold.entityId;
  }
  return true;
}

function actionable(prediction: Prediction): boolean {
  if (prediction.action === "none") return true;
  if (prediction.action === "cash" || prediction.action === "investigate") return true;
  if (!prediction.entityId) return false;
  if (prediction.action === "reorder") return Number(prediction.qty ?? 0) > 0;
  return true;
}

function runRules(scenario: Scenario): EngineResult {
  const started = performance.now();
  const intelligence = generateIntelligence(scenario.projection, []);
  const top = intelligence.decisions[0];
  const elapsed = performance.now() - started;
  const prediction: Prediction = top
    ? {
        action: top.action.type as GoldAction,
        entityId: top.entityId,
        qty: top.action.qty,
        confidence: top.confidence,
        reason: top.title
      }
    : {
        action: "none",
        confidence: 0.75,
        reason: "No rule fired."
      };
  return {
    prediction,
    correct: correct(scenario, prediction),
    actionable: actionable(prediction),
    latencyMs: elapsed,
    costUsd: 0
  };
}

function factsForPrompt(scenario: Scenario): string {
  const facts = generateIntelligence(scenario.projection, []).facts;
  const orders = scenario.projection.pendingOrders.map((order) => ({
    orderId: order.orderId,
    customer: order.customerName,
    channel: order.channel,
    totalCents: order.totalCents,
    status: order.status,
    ageHours: Math.max(0, (Date.now() - Date.parse(order.createdAt)) / 3_600_000)
  }));
  return JSON.stringify({
    businessDate: facts.businessDate,
    cashPositionCents: facts.cashPositionCents,
    minimumCashCents: facts.minimumCashCents,
    cashRunwayDays: facts.cashRunwayDays,
    pendingOrders: orders,
    salesTodayCents: facts.salesTodayCents,
    salesLast7Cents: facts.sales7Cents,
    salesPrevious7Cents: facts.salesPrev7Cents,
    salesTrendPct: facts.trendPct,
    dataQuality: facts.dataQuality,
    products: facts.products.map((product) => ({
      productId: product.productId,
      name: product.name,
      stock: product.stock,
      priceCents: product.priceCents,
      costCents: product.costCents,
      unitsLast14: product.units14,
      velocityPerDay: Number(product.velocityPerDay.toFixed(2)),
      stockCoverDays: product.stockCoverDays === null ? null : Number(product.stockCoverDays.toFixed(1)),
      supplierLeadDays: product.supplierLeadDays,
      marginPct: product.marginPct === null ? null : Number((product.marginPct * 100).toFixed(1)),
      lastSoldAt: product.lastSoldAt
    }))
  });
}

function parseLlm(content: string): Prediction {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const rawAction = String(parsed.action ?? "none").toLowerCase();
  const action = (ALLOWED.includes(rawAction as GoldAction) ? rawAction : "none") as GoldAction;
  const entityId = typeof parsed.entityId === "string" && parsed.entityId.length > 0 ? parsed.entityId : undefined;
  const qty = typeof parsed.qty === "number" ? parsed.qty : Number(parsed.qty ?? 0) || 0;
  const confidence = clamp(Number(parsed.confidence ?? 0.5));
  const reason = String(parsed.reason ?? "");
  return { action, entityId, qty, confidence, reason };
}

async function fetchGroq(request: Record<string, unknown>): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    lastResponse = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(45_000)
    });
    if (lastResponse.status !== 429) return lastResponse;
    const text = await lastResponse.clone().text();
    const header = lastResponse.headers.get("retry-after");
    const match = /try again in ([\d.]+)\s*(ms|s)/i.exec(text);
    const waitMs = header
      ? Number(header) * 1000
      : match
        ? (match[2]?.toLowerCase() === "ms" ? Number(match[1]) : Number(match[1]) * 1000) + 500
        : 15_000;
    await new Promise((resolve) => setTimeout(resolve, Math.min(65_000, Math.max(500, waitMs))));
  }
  return lastResponse!;
}

async function runLlm(scenario: Scenario): Promise<LlmResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  const started = performance.now();
  const system = [
    "You are Ustadi's System One decision layer for a small shop.",
    "You receive a compact business state and must choose exactly one action.",
    "Return JSON only, with no markdown.",
    'Schema: {"action":"reorder|discount|price|fulfill|cash|investigate|none","entityId":"optional product or order id","qty":0,"confidence":0.0,"reason":"one sentence"}',
    "Rules:",
    "reorder = stock is at risk; entityId must be a product id; qty is the order quantity.",
    "discount = dead stock; entityId must be a product id.",
    "price = margin leak; entityId must be a product id.",
    "fulfill = a pending order should be fulfilled; entityId must be an order id.",
    "cash = a cash gap or short runway; no entityId.",
    "investigate = a sales anomaly; no entityId.",
    "none = nothing is actionable.",
    "Never invent a product or order id. If the evidence is weak, use none."
  ].join("\n");
  const user = `Business state:\n${factsForPrompt(scenario)}\n\nChoose one action. Return only the JSON object.`;

  const response = await fetchGroq({
    model: MODEL,
    temperature: 0,
    max_completion_tokens: 1200,
    reasoning_effort: "low",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });
  const latencyMs = performance.now() - started;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq ${response.status}: ${body.slice(0, 300)}`);
  }
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: LlmUsage;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  let prediction: Prediction;
  let parseError: string | undefined;
  try {
    prediction = parseLlm(content);
  } catch (error) {
    prediction = { action: "none", confidence: 0.5, reason: "Unparseable response" };
    parseError = (error as Error).message;
  }
  const usage = payload.usage;
  const costUsd = ((usage?.prompt_tokens ?? 0) / 1_000_000) * INPUT_USD_PER_M
    + ((usage?.completion_tokens ?? 0) / 1_000_000) * OUTPUT_USD_PER_M;
  return {
    prediction,
    correct: correct(scenario, prediction),
    actionable: actionable(prediction),
    latencyMs,
    costUsd,
    usage,
    parseError,
    valid: !parseError
  };
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function ece(rows: EngineResult[]): number {
  const bins = Array.from({ length: 5 }, () => ({ count: 0, confidence: 0, correct: 0 }));
  for (const row of rows) {
    const index = Math.min(4, Math.floor(row.prediction.confidence * 5));
    const bin = bins[index]!;
    bin.count += 1;
    bin.confidence += row.prediction.confidence;
    bin.correct += row.correct ? 1 : 0;
  }
  let total = 0;
  const n = rows.length || 1;
  for (const bin of bins) {
    if (bin.count === 0) continue;
    total += (bin.count / n) * Math.abs(bin.correct / bin.count - bin.confidence / bin.count);
  }
  return total;
}

function summary(rows: EngineResult[]): {
  accuracy: number;
  actionability: number;
  brier: number;
  ece: number;
  latencyMs: number;
  costUsd: number;
} {
  return {
    accuracy: rows.filter((row) => row.correct).length / (rows.length || 1),
    actionability: rows.filter((row) => row.actionable).length / (rows.length || 1),
    brier: average(rows.map((row) => (row.prediction.confidence - (row.correct ? 1 : 0)) ** 2)),
    ece: ece(rows),
    latencyMs: average(rows.map((row) => row.latencyMs)),
    costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0)
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function usd(value: number): string {
  return value === 0 ? "$0" : `$${value.toFixed(6)}`;
}

async function main(): Promise<void> {
  const ruleRows = SCENARIOS.map((scenario) => ({ scenario, result: runRules(scenario) }));
  const llmRows: Array<{ scenario: Scenario; result: LlmResult }> = [];
  const llmErrors: string[] = [];

  if (process.env.GROQ_API_KEY) {
    for (const [index, scenario] of SCENARIOS.entries()) {
      try {
        llmRows.push({ scenario, result: await runLlm(scenario) });
      } catch (error) {
        llmErrors.push(`${scenario.id}: ${(error as Error).message}`);
        llmRows.push({
          scenario,
          result: {
            prediction: { action: "none", confidence: 0.5, reason: "LLM call failed" },
            correct: correct(scenario, { action: "none", confidence: 0.5, reason: "" }),
            actionable: true,
            latencyMs: 0,
            costUsd: 0,
            error: (error as Error).message,
            valid: false
          }
        });
      }
      if (index < SCENARIOS.length - 1) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const rulesSummary = summary(ruleRows.map((row) => row.result));
  const validLlmRows = llmRows.filter((row) => row.result.valid);
  const llmSummary = validLlmRows.length ? summary(validLlmRows.map((row) => row.result)) : null;
  const generatedAt = new Date().toISOString();

  const reportLines: string[] = [
    "# Ustadi decision benchmark",
    "",
    `Generated: ${generatedAt}`,
    `LLM baseline: ${MODEL} (Groq, temperature 0)`,
    `Scenarios: ${SCENARIOS.length} hand-built shop situations`,
    "",
    "> The scenarios are synthetic and intentionally narrow. The LLM receives the same facts and allowed action schema as the rule engine. Gold actions are author-defined for the benchmark, not a field outcome.",
    "",
    "> The rule engine was designed alongside these scenarios, so 100% is **policy conformance**, not independent superiority. The LLM was measured on the same policy-aligned set.",
    "",
    "## Summary",
    "",
    "| Engine | Accuracy | Actionability | Brier ↓ | ECE ↓ | Avg latency | Total cost |",
    "|---|---:|---:|---:|---:|---:|---:|",
    `| Rules | ${pct(rulesSummary.accuracy)} | ${pct(rulesSummary.actionability)} | ${rulesSummary.brier.toFixed(3)} | ${rulesSummary.ece.toFixed(3)} | ${rulesSummary.latencyMs.toFixed(2)} ms | $0 |`,
    llmSummary
      ? `| LLM (${MODEL}) · ${validLlmRows.length}/${llmRows.length} valid | ${pct(llmSummary.accuracy)} | ${pct(llmSummary.actionability)} | ${llmSummary.brier.toFixed(3)} | ${llmSummary.ece.toFixed(3)} | ${llmSummary.latencyMs.toFixed(0)} ms | ${usd(llmSummary.costUsd)} |`
      : "| LLM | skipped | skipped | — | — | — | — |",
    "",
    "## Per scenario",
    "",
    "| Scenario | Gold | Rules | Rules ✓ | Conf | LLM | LLM ✓ | Conf | LLM latency | LLM cost |",
    "|---|---|---|---:|---:|---|---:|---:|---:|---:|"
  ];

  for (const row of ruleRows) {
    const llm = llmRows.find((item) => item.scenario.id === row.scenario.id)?.result;
    const llmValid = llm?.valid === true;
    const llmAction = llmValid ? `${llm.prediction.action}${llm.prediction.entityId ? `:${llm.prediction.entityId}` : ""}` : "error";
    const llmCorrect = llmValid ? (llm.correct ? "yes" : "no") : "—";
    const llmConfidence = llmValid ? llm.prediction.confidence.toFixed(2) : "—";
    const llmLatency = llmValid ? `${llm.latencyMs.toFixed(0)} ms` : "—";
    const llmCost = llmValid ? usd(llm.costUsd) : "—";
    reportLines.push(
      `| ${row.scenario.id} | ${row.scenario.gold.action}${row.scenario.gold.entityId ? `:${row.scenario.gold.entityId}` : ""} | ${row.result.prediction.action}${row.result.prediction.entityId ? `:${row.result.prediction.entityId}` : ""} | ${row.result.correct ? "yes" : "no"} | ${row.result.prediction.confidence.toFixed(2)} | ${llmAction} | ${llmCorrect} | ${llmConfidence} | ${llmLatency} | ${llmCost} |`
    );
  }

  reportLines.push("");
  if (llmErrors.length > 0) {
    reportLines.push("## LLM errors", "", ...llmErrors.map((error) => `- ${error}`), "");
  }
  reportLines.push(
    "## Reading this",
    "",
    "- Accuracy is action + entity correctness against the gold scenario.",
    "- Actionability means the answer names a concrete action and, where needed, an entity/quantity.",
    "- Brier and ECE measure whether confidence tracks correctness; lower is better.",
    "- Cost is an estimate at $0.15/M input and $0.75/M output tokens for the baseline; it is not a billing statement.",
    "- Rules cost nothing and run offline. The LLM is a paid network call.",
    "",
    "This benchmark is a starting point. The next version should use anonymized real shop ledgers and an accountant-reviewed gold set."
  );

  writeFileSync("bench/results.json", JSON.stringify({
    generatedAt,
    model: MODEL,
    scenarios: ruleRows.map((row) => {
      const llm = llmRows.find((item) => item.scenario.id === row.scenario.id)?.result;
      return {
        id: row.scenario.id,
        title: row.scenario.title,
        gold: row.scenario.gold,
        rules: row.result,
        llm: llm ?? null
      };
    }),
    summary: { rules: rulesSummary, llm: llmSummary },
    llmErrors
  }, null, 2) + "\n");
  writeFileSync("bench/REPORT.md", reportLines.join("\n") + "\n");

  console.log("");
  console.log("USTADI DECISION BENCHMARK");
  console.log("──────────────────────────────────────────");
  console.log(`Scenarios       ${SCENARIOS.length}`);
  console.log(`Rules accuracy  ${pct(rulesSummary.accuracy)}`);
  console.log(`Rules action    ${pct(rulesSummary.actionability)}`);
  console.log(`Rules Brier     ${rulesSummary.brier.toFixed(3)}`);
  console.log(`Rules ECE       ${rulesSummary.ece.toFixed(3)}`);
  console.log(`Rules latency   ${rulesSummary.latencyMs.toFixed(2)} ms`);
  if (llmSummary) {
    console.log(`LLM accuracy    ${pct(llmSummary.accuracy)}`);
    console.log(`LLM action      ${pct(llmSummary.actionability)}`);
    console.log(`LLM Brier       ${llmSummary.brier.toFixed(3)}`);
    console.log(`LLM ECE         ${llmSummary.ece.toFixed(3)}`);
    console.log(`LLM latency     ${llmSummary.latencyMs.toFixed(0)} ms`);
    console.log(`LLM cost        ${usd(llmSummary.costUsd)}`);
  } else {
    console.log("LLM             skipped (set GROQ_API_KEY)");
  }
  console.log("");
  console.log("Report          bench/REPORT.md");
  console.log("Raw results     bench/results.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
