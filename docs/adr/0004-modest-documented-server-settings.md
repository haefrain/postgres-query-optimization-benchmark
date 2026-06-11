# ADR 0004 — Modest, fully-disclosed server settings

**Status:** accepted

**Context.** A benchmark can be gamed by misconfiguring the server — e.g. a tiny `work_mem` to force the "before" query to spill, exaggerating the win.

**Decision.** `docker-compose.yml` pins a small, realistic configuration and the benchmark prints it on every run: `shared_buffers=256MB`, `work_mem=16MB`, `effective_cache_size=1GB`, `random_page_cost=1.1`. The two scenarios that genuinely need a smaller `work_mem` to demonstrate a sort/hash spill set it **explicitly in their own SQL** (`SET work_mem='4MB'`) for _both_ the before and after measurement, so the comparison stays fair and the manipulation is visible in the scenario source.

**Consequences.** Anyone can read the exact configuration that produced the numbers. Nothing is hidden in a global override.
