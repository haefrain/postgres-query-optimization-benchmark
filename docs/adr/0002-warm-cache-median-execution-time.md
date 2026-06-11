# ADR 0002 — Warm-cache median of `EXPLAIN ANALYZE` execution time

**Status:** accepted

**Context.** "How fast is this query" has several honest answers (cold vs warm cache, mean vs median, client round-trip vs server execution). An unstated choice makes a benchmark cherry-pickable.

**Decision.** The reported number is the **median** of PostgreSQL's own `Execution Time` from `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, after **2 warm-up runs**, over **7 measured runs**.

- _Execution time, not client wall-clock_ — excludes network and driver overhead, isolating the query.
- _Median, not mean_ — robust to the occasional GC/IO outlier.
- _Warm cache_ — deterministic and reproducible; cold-cache numbers are larger but noisy. Warm cache is the _conservative_ choice: it makes the "before" queries look as good as they ever will, so the measured speedups are a floor, not a ceiling.

**Consequences.** Numbers are stable run-to-run on a given machine and reproducible in spirit across machines. Absolute milliseconds vary by hardware; the plan change and buffer counts (see [0003](0003-buffers-as-headline-metric.md)) do not.
