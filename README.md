# PostgreSQL Query Optimization Benchmark

[![CI](https://github.com/haefrain/postgres-query-optimization-benchmark/actions/workflows/ci.yml/badge.svg)](https://github.com/haefrain/postgres-query-optimization-benchmark/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)

🇪🇸 [Versión en español](README.es.md)

A **reproducible** PostgreSQL query optimization benchmark over a 1.5M+ row delivery-orders dataset. Every scenario pairs a realistic slow query with its optimized version, and the harness captures the real `EXPLAIN (ANALYZE, BUFFERS)` plan before and after — so the speedups are evidence you can re-run, not claims.

> 🚧 **Work in progress** — built milestone by milestone with green tests and CI.

## Why this exists

"I made it 95% faster" means nothing without numbers anyone can reproduce. This repo turns that claim into a runnable artifact: one command seeds a large, realistically-skewed dataset; another runs a catalog of optimization scenarios and prints a before/after table straight from PostgreSQL's own planner.

The dataset mirrors a delivery-orders platform (companion to the [Delivery Orders Hub](https://github.com/haefrain/delivery-orders-hub)) — same domain, this time focused on keeping the database fast at scale.

## Quick start

```bash
docker compose up -d        # PostgreSQL 16 with realistic memory settings
pnpm install
# schema + seed + benchmark commands land in upcoming milestones
```

## Roadmap

- [x] **B1** — Project skeleton, tooling, Docker Postgres, CI
- [x] **B2** — Delivery schema + deterministic 1.5M+ row seed
- [ ] **B3** — Benchmark harness (EXPLAIN ANALYZE capture, warm-up, median timing)
- [ ] **B4** — ~10–12 optimization scenarios, measured against real Postgres
- [ ] **B5** — Before/after results table, methodology, ADRs

## License

[MIT](LICENSE) © Efraín Hernández
