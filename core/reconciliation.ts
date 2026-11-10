import type { PaymentRecord, Projection, Sale } from "./types.ts";

export interface StatementRow {
  date: string;
  description: string;
  amountCents: number;
  reference: string;
  method: "cash" | "mpesa" | "card";
}

export interface ReconciledRow {
  statement: StatementRow;
  payment?: PaymentRecord;
  sale?: Sale;
  status: "matched" | "amount-only" | "unmatched";
}

export interface ReconciliationResult {
  rows: ReconciledRow[];
  matched: number;
  unmatched: number;
  statementTotalCents: number;
  matchedTotalCents: number;
  unmatchedTotalCents: number;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

const DATE_KEYS = ["date", "transaction date", "completion time", "time", "created at"];
const AMOUNT_KEYS = ["amount", "paid in", "money in", "credit", "value"];
const REFERENCE_KEYS = ["reference", "receipt no", "receipt number", "transaction id", "mpesa code", "code"];
const DESCRIPTION_KEYS = ["description", "details", "narrative", "particulars"];

function headerIndex(headers: string[], keys: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase().replace(/^\ufeff/, ""));
  for (const key of keys) {
    const index = normalized.indexOf(key);
    if (index >= 0) return index;
  }
  return -1;
}

function normalizeDate(raw: string): string {
  const value = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(value);
  if (slash) {
    let first = Number(slash[1]);
    let second = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    if (first > 12 && second <= 12) {
      // day-first
    } else if (second > 12 && first <= 12) {
      const swap = first;
      first = second;
      second = swap;
    }
    return `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
  }
  return value.slice(0, 10);
}

function toCents(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "").replace(/,/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.abs(value) * 100);
}

export function parseStatement(text: string, method: StatementRow["method"] = "mpesa"): StatementRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0]!;
  const dateIndex = headerIndex(headers, DATE_KEYS);
  const amountIndex = headerIndex(headers, AMOUNT_KEYS);
  const referenceIndex = headerIndex(headers, REFERENCE_KEYS);
  const descriptionIndex = headerIndex(headers, DESCRIPTION_KEYS);
  if (dateIndex < 0 || amountIndex < 0) return [];

  return rows.slice(1).map((row) => ({
    date: normalizeDate(row[dateIndex] ?? ""),
    description: descriptionIndex >= 0 ? (row[descriptionIndex] ?? "").trim() : "",
    amountCents: toCents(row[amountIndex] ?? ""),
    reference: referenceIndex >= 0 ? (row[referenceIndex] ?? "").trim() : "",
    method
  })).filter((row) => row.amountCents > 0);
}

function daysBetween(a: string, b: string): number {
  const first = new Date(`${a}T00:00:00`).getTime();
  const second = new Date(`${b}T00:00:00`).getTime();
  return Math.abs(Math.round((first - second) / 86400000));
}

export function reconcile(statement: StatementRow[], projection: Projection): ReconciliationResult {
  const rows: ReconciledRow[] = statement.map((row) => {
    const byReference = row.reference
      ? projection.payments.find((payment) => payment.reference && payment.reference.toLowerCase() === row.reference.toLowerCase())
      : undefined;
    const payment = byReference ?? projection.payments.find((candidate) =>
      candidate.method === row.method &&
      candidate.amountCents === row.amountCents &&
      daysBetween(candidate.businessDate, row.date) <= 2
    );
    const sale = payment?.saleId ? projection.sales.find((candidate) => candidate.saleId === payment.saleId) : undefined;
    const status: ReconciledRow["status"] = payment
      ? byReference ? "matched" : "amount-only"
      : "unmatched";
    return { statement: row, payment, sale, status };
  });

  const statementTotalCents = rows.reduce((sum, row) => sum + row.statement.amountCents, 0);
  const matchedTotalCents = rows.filter((row) => row.payment).reduce((sum, row) => sum + row.statement.amountCents, 0);

  return {
    rows,
    matched: rows.filter((row) => row.status === "matched").length,
    unmatched: rows.filter((row) => row.status === "unmatched").length,
    statementTotalCents,
    matchedTotalCents,
    unmatchedTotalCents: statementTotalCents - matchedTotalCents
  };
}
