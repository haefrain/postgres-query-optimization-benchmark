# PostgreSQL Query Optimization Benchmark

[![CI](https://github.com/haefrain/postgres-query-optimization-benchmark/actions/workflows/ci.yml/badge.svg)](https://github.com/haefrain/postgres-query-optimization-benchmark/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)

🇪🇸 [Versión en español](README.es.md)

A **reproducible** PostgreSQL query optimization benchmark over a 1.5M+ row delivery-orders dataset. Fifteen real-world scenarios each pair a naive slow query with its idiomatic fix; a TypeScript harness runs both, captures PostgreSQL's own `EXPLAIN (ANALYZE, BUFFERS)` plan, and records the before/after numbers. The speedups aren't claims — they're a recorded run you can regenerate in three commands.

## Why this exists

"I made it 95% faster" means nothing without numbers anyone can reproduce. This repo turns that sentence into a runnable artifact: a deterministic seed builds a large, realistically-skewed dataset, and one command measures a catalog of optimizations against it. Every scenario also **asserts the plan change actually happened** ([ADR 0005](docs/adr/0005-verify-the-plan-change.md)), so the catalog can't rot into "fast, but for the wrong reason."

The dataset mirrors a delivery-orders platform (companion to the [Delivery Orders Hub](https://github.com/haefrain/delivery-orders-hub)) — same domain, this time about keeping the database fast at scale.

## Results

Recorded run: **PostgreSQL 16.14, 1,500,000 orders / ~4.5M order items**, `shared_buffers=256MB`, `work_mem=16MB`. Median of 7 warm-cache runs ([methodology](#methodology)). Your milliseconds will differ by hardware; **the plan change and the buffer reduction will not**.

<!-- generated from results/results.json -->

| Optimization                                                                        | Category                   |  Before |    After |   Speedup | Buffers (8KB blocks) read |
| ----------------------------------------------------------------------------------- | -------------------------- | ------: | -------: | --------: | ------------------------- |
| A missing index turns a customer lookup into a full-table scan                      | Indexing fundamentals      |   20 ms | 0.014 ms | **1414×** | 66,760 → 18               |
| A function on an indexed column defeats the index (sargability)                     | Anti-patterns              |   35 ms |  0.15 ms |  **231×** | 88,816 → 80               |
| Case-insensitive email lookup needs an expression index                             | Indexing fundamentals      |   16 ms | 0.009 ms | **1758×** | 4,528 → 4                 |
| Anchored LIKE 'prefix%' served by a text_pattern_ops index                          | Indexing fundamentals      | 4.19 ms | 0.014 ms |  **300×** | 9,167 → 9                 |
| A partial index for the rare rows an ops dashboard actually wants                   | Partial & covering indexes |   32 ms | 0.015 ms | **2101×** | 89,038 → 28               |
| A covering composite index gives an Index-Only Scan (Heap Fetches: 0)               | Partial & covering indexes |   21 ms | 0.011 ms | **1949×** | 89,038 → 8                |
| Deep OFFSET pagination vs keyset (seek) pagination                                  | Anti-patterns              |   88 ms | 0.014 ms | **6285×** | 89,080 → 10               |
| An OR across two columns defeats a single index; UNION ALL fixes it                 | Anti-patterns              |   22 ms |  0.10 ms |  **209×** | 66,760 → 861              |
| N+1 collapsed into a JOIN — and the FK index that makes it a Nested Loop            | Joins                      |   99 ms | 0.027 ms | **3678×** | 259,304 → 69              |
| NOT IN over a nullable column returns wrong results; NOT EXISTS fixes it            | Anti-patterns              | 3.51 ms |  1.26 ms |  **2.8×** | 25,428 → 212              |
| Leading-wildcard ILIKE search served by a trigram GIN index                         | Full-text & JSONB          |   29 ms |  0.30 ms | **95.8×** | 9,167 → 359               |
| JSONB containment filter served by a GIN index                                      | Full-text & JSONB          |   39 ms |  8.09 ms |  **4.8×** | 89,038 → 28,975           |
| A BRIN index: tiny footprint for time-range scans on append-only data               | Specialized indexes        |   24 ms |  6.87 ms |  **3.5×** | 88,816 → 11,786           |
| Latest order per customer: external-merge sort vs DISTINCT ON over a covering index | Aggregation                |  411 ms |  91.1 ms |  **4.5×** | 66,612 → 27,120           |
| A dashboard re-aggregating 2 years on every load vs a materialized-view rollup      | Aggregation                |  477 ms |  30.1 ms | **15.8×** | 88,816 → 26,704           |

Not every win is a thousand-fold: the `NOT IN` case is only 2.8× faster but fixes a **correctness bug** (it silently returns 0 rows because a NULL poisons the set); BRIN's headline isn't speed but **footprint** (see below). Showing the range is the point.

### The buffers tell the real story

Speedups over 1000× look too good until you see _why_. Here is the actual `EXPLAIN (ANALYZE, BUFFERS)` for the first row, before and after one `CREATE INDEX`:

```text
BEFORE  ── Parallel Seq Scan on orders  (actual time=8.7..20.0 rows=2 loops=3)
              Filter: (customer_id = 137042)
              Rows Removed by Filter: 499998          -- × 3 workers ≈ 1.5M rows examined
              Buffers: shared hit=21674 read=530       -- ~22,000 8KB blocks touched

AFTER   ── Index Scan using idx_orders_customer_id on orders (actual time=0.015..0.025 rows=6)
              Index Cond: (customer_id = 137042)
              Buffers: shared hit=6 read=3             -- 9 blocks touched
```

The 9-vs-22,000 block difference is a property of the **plan**, not the machine — reproducible anywhere ([ADR 0003](docs/adr/0003-buffers-as-headline-metric.md)).

### Footprint matters too

Specialized indexes win on size, not just time (1.5M-row `orders`, `placed_at`):

| Index                                  |       Size | Note                                                  |
| -------------------------------------- | ---------: | ----------------------------------------------------- |
| B-tree on `placed_at`                  |      32 MB | full per-row index                                    |
| **BRIN** on `placed_at`                |  **24 kB** | ~1,300× smaller, viable because data is time-ordered  |
| Full B-tree on `placed_at`             |      32 MB | indexes all 1.5M rows                                 |
| **Partial** index (active orders only) | **2.6 MB** | ~12× smaller, indexes only the ~8% non-delivered rows |

## Quick start

```bash
docker compose up -d        # PostgreSQL 16 with the documented settings
pnpm install
pnpm seed                   # deterministic ~1.5M order dataset (~70s)
pnpm benchmark              # runs all scenarios, prints the table, writes results/results.json
```

A small dataset for a quick look: `SEED_SCALE=0.05 pnpm seed`.

## Methodology

- **Metric:** median of PostgreSQL's `Execution Time` from `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, 2 warm-ups + 7 measured runs ([ADR 0002](docs/adr/0002-warm-cache-median-execution-time.md)).
- **Warm cache** is the _conservative_ choice: it makes the "before" query look as fast as it ever will, so the reported speedup is a floor.
- **Buffers** are reported next to every timing as the machine-independent proof ([ADR 0003](docs/adr/0003-buffers-as-headline-metric.md)).
- **Server settings** are modest and printed on every run; the two spill scenarios set `work_mem` in their own SQL, visibly, for both sides ([ADR 0004](docs/adr/0004-modest-documented-server-settings.md)).
- **Every scenario verifies its plan change** — the run fails if an optimization stops doing what it claims ([ADR 0005](docs/adr/0005-verify-the-plan-change.md)).
- **Fully reproducible:** the dataset is generated from a seeded hash, no `random()`, no external downloads ([ADR 0001](docs/adr/0001-deterministic-seeded-hash-dataset.md)).

## How it's built

| Piece                                                             | Where                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The 15 scenarios (slow SQL, fix, teardown, plan-change assertion) | [`src/scenarios.ts`](src/scenarios.ts)                                                     |
| Schema + deterministic seeded-hash generator                      | [`sql/schema.sql`](sql/schema.sql), [`src/seed`](src/seed)                                 |
| Harness: warm-up, median timing, EXPLAIN capture, verification    | [`src/lib/benchmark.ts`](src/lib/benchmark.ts), [`src/lib/explain.ts`](src/lib/explain.ts) |
| Recorded results                                                  | [`results/results.json`](results/results.json)                                             |
| Design decisions (ADR-lite)                                       | [`docs/adr`](docs/adr)                                                                     |

The dataset is realistically skewed so the optimizations are meaningful: status is ~92% `DELIVERED` (a single-column index on it is correctly _rejected_ by the planner, which is the point of the partial-index scenario); `placed_at` is monotonic with id (physical correlation > 0.999, which is what makes BRIN viable); `metadata` carries a ~0.8% `FREESHIP`-on-web slice so the JSONB filter is genuinely selective.

## Testing

```bash
pnpm test                  # unit suites (plan parsing, stats, catalog integrity)
docker compose up -d
pnpm test:integration      # harness against real Postgres (self-seeds small, proves a real plan change)
```

CI runs the unit suites, the seeder, and the integration test on every push. The full-scale benchmark is a local run by design ([ADR 0006](docs/adr/0006-scale-aware-seed.md)): the planner picks different plans on a tiny table, so headline numbers come from a real 1.5M-row dataset, not from CI.

## Honest caveats

Absolute milliseconds are warm-cache and single-machine; they will differ on your hardware. The durable, reproducible claims are the **plan changes** and the **buffer reductions**, which are deterministic. The point-lookup speedups (1000×+) compare a full scan to an index seek — that ratio is real but expected; the aggregation and BRIN/JSONB scenarios (3–16×) are the more "everyday" wins.

## License

[MIT](LICENSE) © Efraín Hernández
