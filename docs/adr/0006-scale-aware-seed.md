# ADR 0006 — Scale-aware seed; CI verifies mechanics, headline numbers come from a full local run

**Status:** accepted

**Context.** The headline numbers need 1.5M+ rows, but seeding and benchmarking that in CI on every push is slow, and the planner legitimately prefers a Seq Scan on a tiny table — so running the full catalog in CI would produce _different plans_ and flaky verdicts.

**Decision.** `SEED_SCALE` multiplies the row counts (1 = full ~1.5M orders; restaurants and couriers stay fixed so foreign keys and fixtures hold at any scale). CI seeds a tiny dataset (`SEED_SCALE=0.02`) and runs one harness integration test to prove the _machinery_ end-to-end against real Postgres. The published table comes from a full-scale local run, recorded in `results/results.json` with its environment.

**Consequences.** CI stays fast and stable and still catches real breakage (schema, seed, harness). The headline metrics are honest about being a recorded full-scale run, reproducible with `docker compose up && pnpm seed && pnpm benchmark`.
