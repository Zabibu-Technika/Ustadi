# Ustadi

**The local-first merchant ledger.** Counter, pocket, and a daily brief — one ledger, no cloud required.

Ustadi is built for the shop that runs on cash, M-Pesa, card, WhatsApp, and a notebook. It gives the counter a fast point of sale, the owner a phone-sized daily brief, and both of them one reconciled ledger. Devices sync when they are close. The cloud is optional, never the default.

```
Counter (desktop / tablet)  ── nearby sync ──  Pocket (phone PWA)
            │                                      │
            └──────────── local ledger ────────────┘
                         offline licence
```

## What is in the box

| Surface | What it does |
|---|---|
| **Ustadi Counter** | Sell, take cash / M-Pesa / card, print a receipt, manage stock, log digital orders, close the day. |
| **Ustadi Pocket** | The owner's daily brief: sales, cash, gross profit, low stock, waiting orders. Cached for offline viewing. |
| **Ustadi Ledger** | An append-only event log with a hash chain, deterministic projection, local backup, and peer-to-peer sync. |
| **Ustadi Licence** | An Ed25519-signed offline licence. No account is required to run the shop. |

The core is **zero-runtime-dependency TypeScript**. The desktop shell is Electron; the pocket is an installable PWA; the counter server is Node 24.

## Quickstart

Node 24+.

```bash
npm install
npm run counter
# open http://localhost:4173
```

The counter seeds a demo shop on first run. It prints the LAN addresses and a pairing code:

```
Local     http://localhost:4173
Nearby    http://192.168.1.20:4173
Pair code ABC123
Data      ./data
```

Open the pocket at `/pocket.html` on a phone connected to the same Wi-Fi or hotspot.

### Desktop shell

```bash
npm run desktop
```

Electron starts the local counter server and opens the counter in a desktop window. The ledger lives in the Electron user-data directory. Node 24 must be on `PATH` for the shell to start the server.

If npm's script policy skipped Electron's postinstall, run this once:

```bash
node node_modules/electron/install.js
```

### Tests and typecheck

```bash
npm test
npm run typecheck
```

The test suite covers hash chains and tamper detection, idempotency, sales/stock projection, sync merge and duplicate suppression, CSV reconciliation, the brief, and offline licence verification.

## Nearby sync

No cloud. The counter is the hub; the phone or a second device is the peer.

1. Put both devices on the same Wi-Fi or use the counter as a hotspot.
2. Open **Sync** on the counter.
3. On the other device, open Ustadi and enter the counter's nearby address plus its pairing code.
4. Choose **Sync now**.

The sync protocol exchanges vector clocks, pulls missing events, pushes local events, and rejects duplicates by idempotency key. Conflicts are domain-specific:

- payments and sales are immutable;
- stock adjustments are additive;
- price changes are last-writer-wins with an audit trail;
- an unresolved conflict is surfaced to a human, not silently overwritten.

The sync endpoints require the pairing code. This is a local-network MVP: do not expose the counter directly to the public internet. TLS and stronger device identity are on the roadmap.

### Backup

The counter has **Download backup** in the Sync panel (`GET /api/backup`). It exports the event log and device metadata as JSON. Keep a copy on a second device, a USB drive, or the merchant's own storage. There is no Ustadi cloud copy by default.

## Intelligence layer

Ustadi has a deterministic **System One** layer: facts, rules, diagnosis, planning, and typed decisions. It is designed to behave like an agent without letting a model invent a number.

```
ledger → facts → rules → diagnosis → plan → decision → approval → tool → outcome
```

The pieces live in `core/intelligence/`:

| File | Role |
|---|---|
| `facts.ts` | Stock cover, velocity, margin, cash runway, pending orders, channel mix, data quality. |
| `rules.ts` | Stockout, dead stock, margin leak, cash gap, order follow-up, sales anomaly. |
| `diagnose.ts` | Contribution analysis and plain-language evidence. |
| `plan.ts` | Reorder quantities, cash-constrained plans, collection and margin actions. |
| `tools.ts` | The only actions the intelligence may call. |
| `triggers.ts` | Event, schedule, and threshold triggers. |
| `engine.ts` | Ranked, typed decisions with status, confidence, and receipts. |

A decision carries `ruleId`, `trigger`, `severity`, `impactCents`, `confidence`, `evidence`, `assumptions`, a diagnosis, a proposed action, and an optional draft. The inbox lets the owner approve, dismiss, or execute it.

### Proactivity

The counter server broadcasts a state refresh after every ledger event and on a five-minute heartbeat. The rules re-run against the current projection, so the inbox reacts to a sale, an order, a stock movement, an expense, or simply time passing. It is a durable ledger plus triggers, not a chat prompt.

### Tools, not vibes

The intelligence layer can call:

- `draft_message` — render a WhatsApp/note draft; never sends.
- `record_decision` — approve or dismiss a proposal.
- `fulfill_order` — create the sale, take payment, mark the order fulfilled.
- `adjust_stock` — record a stock movement.
- `record_expense` — add an expense.

Every mutating tool requires `approved: true`. The inbox passes that only after a human click. Tool calls write to the same append-only ledger and appear in the receipt trail.

### API

- `GET /api/intelligence` — facts, ranked decisions, tool catalog, proactive status.
- `POST /api/intelligence/run` — force a rule run.
- `POST /api/decisions/:id` — approve, dismiss, or mark done.
- `POST /api/tools/:id` — call a tool with explicit approval.

No LLM is in this layer today. When one is added, it will parse intent and phrase explanations; the arithmetic, rules, and actions stay deterministic.

## Offline licence

Community mode is free and limited to one shop and 25 products. A signed licence unlocks the shop.

```bash
npm run license -- --shop="Mama Njeri's Shop"
```

This creates, in `data/`:

- `license.json` — the signed licence;
- `license-public.pem` — the public key the app verifies against;
- `license-private.pem` — the signing key. **Keep this offline and never commit it.**

`data/` is gitignored. In production, the public key should be embedded in the app and the private key kept on a separate signing machine.

## Data and configuration

| Variable | Default | Meaning |
|---|---|---|
| `USTADI_DATA` | `./data` | Ledger directory (JSONL + metadata + licence). |
| `USTADI_PORT` | `4173` | Local counter port. |
| `USTADI_HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` to disable LAN access. |
| `USTADI_SEED` | on | Set `0` to start with an empty ledger. |

The ledger is `data/ledger.jsonl`. Every event is hash-chained. A torn final line is ignored on load, not fatal.

## Core layout

```
core/
  canonical.ts      stable JSON, SHA-256, KES formatting, local dates
  events.ts         event creation, hash verification, ordering
  store.ts          append-only JSONL store, device identity, vector clocks
  projection.ts     pure projection: products, sales, orders, cash, stock, brief data
  brief.ts          daily brief and actions
  sync.ts           vector delta, merge, peer sync
  reconciliation.ts CSV parsing and M-Pesa/bank matching
  license.ts        Ed25519 offline licence
  seed.ts           demo shop
apps/
  counter/          Node server + POS UI + pocket PWA
  desktop/          Electron shell
website/            marketing site + standalone browser demo
tests/              core tests
scripts/            seed and licence issuing
```

## API

The counter exposes a small local JSON API:

- `GET /api/state` — full projection, brief, licence, vector, device meta.
- `POST /api/sales` — record a sale.
- `POST /api/products`, `POST /api/stock` — catalogue and stock.
- `POST /api/orders`, `POST /api/orders/:id/pay`, `POST /api/orders/:id/fulfill` — digital orders.
- `POST /api/expenses` — expenses.
- `POST /api/reconcile` — import a CSV statement and match payments.
- `GET /api/sync/state`, `POST /api/sync/pull`, `POST /api/sync/push`, `POST /api/sync/peer` — nearby sync.
- `GET /api/backup` — local backup.
- `GET /api/events` — SSE stream for live UI updates.

## Website

`website/` is a static site with a standalone, browser-only counter demo at `/demo/`. It uses the real counter screenshots and the same design language as the product.

```bash
cd website
vercel --prod --yes --project ustadiapp
```

The public site is deployed at **https://ustadiapp.vercel.app** (the shorter `ustadi.vercel.app` was already taken).

## What is deliberately not here yet

- A real M-Pesa Daraja / card-terminal integration. The ledger has payment methods and pending states; the money rail is a partner integration.
- eTIMS/VAT filing and full accounting.
- Multi-branch relay and accountant console.
- TLS and hardened pairing for an untrusted LAN.
- A packaged installer. `npm run desktop` is the working shell; packaging is the next step.
- A hosted cloud sync layer. That is a product decision, not an accident.
- A language/LLM shell. The intelligence layer is rules-first; an LLM will parse intent and phrase explanations, never calculate.
- Statistically calibrated confidence. Current confidence is a transparent rule heuristic, not a trained probability.
- Customer credit/receivables and supplier purchase orders. Cash-gap decisions use expenses and pending orders; reorder approval records the plan but does not create a purchase order yet.

## Status

`v0.2.0` — a working local-first core, counter, pocket, nearby sync, offline licence, deterministic intelligence layer, demo, and website. It is ready to pilot with a real shop and a real M-Pesa statement.

## Licence

MIT. See [LICENSE](LICENSE). A Zabibu Technika product, built from Nairobi.
