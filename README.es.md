# PostgreSQL Query Optimization Benchmark

[![CI](https://github.com/haefrain/postgres-query-optimization-benchmark/actions/workflows/ci.yml/badge.svg)](https://github.com/haefrain/postgres-query-optimization-benchmark/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)

🇬🇧 [English version](README.md)

Un benchmark **reproducible** de optimización de queries en PostgreSQL sobre un dataset de pedidos de delivery de 1.5M+ filas. Cada escenario empareja una query lenta realista con su versión optimizada, y el harness captura el plan real de `EXPLAIN (ANALYZE, BUFFERS)` antes y después — así las mejoras son evidencia que puedes re-ejecutar, no afirmaciones.

> 🚧 **En construcción** — desarrollado hito a hito con tests y CI en verde.

## ¿Por qué existe?

"Lo hice 95% más rápido" no significa nada sin números que cualquiera pueda reproducir. Este repo convierte esa afirmación en un artefacto ejecutable: un comando siembra un dataset grande y con sesgo realista; otro corre un catálogo de escenarios de optimización e imprime una tabla antes/después directo del planner de PostgreSQL.

El dataset refleja una plataforma de pedidos de delivery (complemento del [Delivery Orders Hub](https://github.com/haefrain/delivery-orders-hub)) — mismo dominio, esta vez enfocado en mantener la base de datos rápida a escala.

## Arranque rápido

```bash
docker compose up -d        # PostgreSQL 16 con settings de memoria realistas
pnpm install
# los comandos de esquema + seed + benchmark llegan en los próximos hitos
```

## Roadmap

- [x] **B1** — Esqueleto del proyecto, tooling, Postgres en Docker, CI
- [x] **B2** — Esquema de delivery + seed determinista de 1.5M+ filas
- [x] **B3** — Harness de benchmark (captura de EXPLAIN ANALYZE, warm-up, mediana)
- [ ] **B4** — ~10–12 escenarios de optimización, medidos contra Postgres real
- [ ] **B5** — Tabla de resultados antes/después, metodología, ADRs

## Licencia

[MIT](LICENSE) © Efraín Hernández
