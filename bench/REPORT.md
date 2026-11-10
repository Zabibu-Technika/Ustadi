# Ustadi decision benchmark

Generated: 2026-11-10T13:32:53.222Z
LLM baseline: openai/gpt-oss-120b (Groq, temperature 0)
Scenarios: 12 hand-built shop situations

> The scenarios are synthetic and intentionally narrow. The LLM receives the same facts and allowed action schema as the rule engine. Gold actions are author-defined for the benchmark, not a field outcome.

> The rule engine was designed alongside these scenarios, so 100% is **policy conformance**, not independent superiority. The LLM was measured on the same policy-aligned set.

## Summary

| Engine | Accuracy | Actionability | Brier ↓ | ECE ↓ | Avg latency | Total cost |
|---|---:|---:|---:|---:|---:|---:|
| Rules | 100.0% | 100.0% | 0.037 | 0.187 | 4.82 ms | $0 |
| LLM (openai/gpt-oss-120b) · 12/12 valid | 75.0% | 100.0% | 0.197 | 0.173 | 984 ms | $0.001808 |

## Per scenario

| Scenario | Gold | Rules | Rules ✓ | Conf | LLM | LLM ✓ | Conf | LLM latency | LLM cost |
|---|---|---|---:|---:|---|---:|---:|---:|---:|
| healthy | none | none | yes | 0.75 | none | yes | 0.95 | 889 ms | $0.000181 |
| stockout | reorder:p-bread | reorder:p-bread | yes | 0.82 | reorder:p-bread | yes | 0.92 | 822 ms | $0.000161 |
| stockout-edge | reorder:p-bread-edge | reorder:p-bread-edge | yes | 0.82 | reorder:p-bread-edge | yes | 0.92 | 788 ms | $0.000156 |
| cash-constrained-stockout | cash | cash:cash | yes | 0.80 | cash | yes | 0.95 | 1227 ms | $0.000116 |
| dead-stock | discount:p-lamp | discount:p-lamp | yes | 0.82 | discount:p-lamp | yes | 0.95 | 659 ms | $0.000140 |
| dead-stock-low-value | none | none | yes | 0.75 | discount:p-cheap-lamp | no | 0.95 | 602 ms | $0.000138 |
| margin-leak | price:p-leaky-oil | price:p-leaky-oil | yes | 0.90 | price:p-leaky-oil | yes | 0.90 | 1856 ms | $0.000140 |
| cash-gap | cash | cash:cash | yes | 0.80 | cash | yes | 0.95 | 1046 ms | $0.000120 |
| cash-runway | cash | cash:cash | yes | 0.80 | none | no | 1.00 | 890 ms | $0.000167 |
| order-follow-up | fulfill:o-1 | fulfill:o-1 | yes | 0.90 | fulfill:o-1 | yes | 0.99 | 635 ms | $0.000155 |
| sales-anomaly | investigate | investigate:2026-11-10 | yes | 0.85 | investigate | yes | 0.95 | 643 ms | $0.000153 |
| low-data | none | none | yes | 0.75 | discount:p-low-data | no | 0.65 | 1749 ms | $0.000182 |

## Reading this

- Accuracy is action + entity correctness against the gold scenario.
- Actionability means the answer names a concrete action and, where needed, an entity/quantity.
- Brier and ECE measure whether confidence tracks correctness; lower is better.
- Cost is an estimate at $0.15/M input and $0.75/M output tokens for the baseline; it is not a billing statement.
- Rules cost nothing and run offline. The LLM is a paid network call.

This benchmark is a starting point. The next version should use anonymized real shop ledgers and an accountant-reviewed gold set.
