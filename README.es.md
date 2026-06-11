# PostgreSQL Query Optimization Benchmark

[![CI](https://github.com/haefrain/postgres-query-optimization-benchmark/actions/workflows/ci.yml/badge.svg)](https://github.com/haefrain/postgres-query-optimization-benchmark/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)

🇬🇧 [English version](README.md)

Un benchmark **reproducible** de optimización de queries en PostgreSQL sobre un dataset de pedidos de delivery de 1.5M+ filas. Quince escenarios reales emparejan una query lenta ingenua con su corrección idiomática; un harness en TypeScript corre ambas, captura el plan de `EXPLAIN (ANALYZE, BUFFERS)` del propio PostgreSQL y registra los números antes/después. Las mejoras no son afirmaciones — son una corrida registrada que regeneras en tres comandos.

## ¿Por qué existe?

"Lo hice 95% más rápido" no significa nada sin números que cualquiera pueda reproducir. Este repo convierte esa frase en un artefacto ejecutable: un seed determinista construye un dataset grande y con sesgo realista, y un comando mide un catálogo de optimizaciones contra él. Cada escenario además **verifica que el cambio de plan realmente ocurrió** ([ADR 0005](docs/adr/0005-verify-the-plan-change.md)), así el catálogo no se degrada a "rápido, pero por la razón equivocada".

El dataset refleja una plataforma de pedidos de delivery (complemento del [Delivery Orders Hub](https://github.com/haefrain/delivery-orders-hub)) — mismo dominio, esta vez sobre mantener la base de datos rápida a escala.

## Resultados

Corrida registrada: **PostgreSQL 16.14, 1.500.000 pedidos / ~4.5M ítems**, `shared_buffers=256MB`, `work_mem=16MB`. Mediana de 7 corridas en caché caliente ([metodología](#metodología)). Tus milisegundos variarán según el hardware; **el cambio de plan y la reducción de buffers no**.

<!-- generado desde results/results.json -->

| Optimización                                                                         | Categoría                    |   Antes |  Después |   Speedup | Buffers (bloques 8KB) leídos |
| ------------------------------------------------------------------------------------ | ---------------------------- | ------: | -------: | --------: | ---------------------------- |
| Un índice faltante convierte un lookup de cliente en scan de toda la tabla           | Fundamentos de índices       |   20 ms | 0.014 ms | **1414×** | 66.760 → 18                  |
| Una función sobre una columna indexada anula el índice (sargabilidad)                | Anti-patrones                |   35 ms |  0.15 ms |  **231×** | 88.816 → 80                  |
| Búsqueda de email case-insensitive necesita un índice de expresión                   | Fundamentos de índices       |   16 ms | 0.009 ms | **1758×** | 4.528 → 4                    |
| LIKE 'prefijo%' anclado servido por un índice text_pattern_ops                       | Fundamentos de índices       | 4.19 ms | 0.014 ms |  **300×** | 9.167 → 9                    |
| Un índice parcial para las filas raras que el dashboard realmente quiere             | Índices parciales y covering |   32 ms | 0.015 ms | **2101×** | 89.038 → 28                  |
| Un índice compuesto covering da un Index-Only Scan (Heap Fetches: 0)                 | Índices parciales y covering |   21 ms | 0.011 ms | **1949×** | 89.038 → 8                   |
| Paginación con OFFSET profundo vs paginación keyset (seek)                           | Anti-patrones                |   88 ms | 0.014 ms | **6285×** | 89.080 → 10                  |
| Un OR entre dos columnas anula un índice; UNION ALL lo arregla                       | Anti-patrones                |   22 ms |  0.10 ms |  **209×** | 66.760 → 861                 |
| N+1 colapsado en un JOIN — y el índice FK que lo hace Nested Loop                    | Joins                        |   99 ms | 0.027 ms | **3678×** | 259.304 → 69                 |
| NOT IN sobre columna nullable devuelve resultados erróneos; NOT EXISTS lo arregla    | Anti-patrones                | 3.51 ms |  1.26 ms |  **2.8×** | 25.428 → 212                 |
| Búsqueda ILIKE con comodín inicial servida por un índice GIN trigram                 | Texto y JSONB                |   29 ms |  0.30 ms | **95.8×** | 9.167 → 359                  |
| Filtro de contención JSONB servido por un índice GIN                                 | Texto y JSONB                |   39 ms |  8.09 ms |  **4.8×** | 89.038 → 28.975              |
| Un índice BRIN: footprint diminuto para scans de rango temporal en datos append-only | Índices especializados       |   24 ms |  6.87 ms |  **3.5×** | 88.816 → 11.786              |
| Último pedido por cliente: sort en disco vs DISTINCT ON sobre índice covering        | Agregación                   |  411 ms |  91.1 ms |  **4.5×** | 66.612 → 27.120              |
| Un dashboard re-agregando 2 años en cada carga vs un rollup en vista materializada   | Agregación                   |  477 ms |  30.1 ms | **15.8×** | 88.816 → 26.704              |

No toda mejora es de mil veces: el caso `NOT IN` es solo 2.8× más rápido pero corrige un **bug de correctitud** (devuelve 0 filas en silencio porque un NULL envenena el conjunto); el titular de BRIN no es velocidad sino **footprint** (ver abajo). Mostrar el rango es el punto.

### Los buffers cuentan la historia real

Speedups de más de 1000× parecen demasiado buenos hasta que ves _por qué_. Este es el `EXPLAIN (ANALYZE, BUFFERS)` real de la primera fila, antes y después de un `CREATE INDEX`:

```text
ANTES   ── Parallel Seq Scan on orders  (actual time=8.7..20.0 rows=2 loops=3)
              Filter: (customer_id = 137042)
              Rows Removed by Filter: 499998          -- × 3 workers ≈ 1.5M filas examinadas
              Buffers: shared hit=21674 read=530       -- ~22.000 bloques de 8KB tocados

DESPUÉS ── Index Scan using idx_orders_customer_id on orders (actual time=0.015..0.025 rows=6)
              Index Cond: (customer_id = 137042)
              Buffers: shared hit=6 read=3             -- 9 bloques tocados
```

La diferencia de 9 vs 22.000 bloques es una propiedad del **plan**, no de la máquina — reproducible en cualquier lado ([ADR 0003](docs/adr/0003-buffers-as-headline-metric.md)).

### El footprint también importa

Los índices especializados ganan en tamaño, no solo en tiempo (tabla `orders` de 1.5M, columna `placed_at`):

| Índice                                    |     Tamaño | Nota                                                                    |
| ----------------------------------------- | ---------: | ----------------------------------------------------------------------- |
| B-tree sobre `placed_at`                  |      32 MB | índice completo por fila                                                |
| **BRIN** sobre `placed_at`                |  **24 kB** | ~1.300× más pequeño, viable porque los datos están ordenados por tiempo |
| B-tree completo sobre `placed_at`         |      32 MB | indexa las 1.5M filas                                                   |
| Índice **parcial** (solo pedidos activos) | **2.6 MB** | ~12× más pequeño, indexa solo el ~8% no entregado                       |

## Arranque rápido

```bash
docker compose up -d        # PostgreSQL 16 con los settings documentados
pnpm install
pnpm seed                   # dataset determinista de ~1.5M pedidos (~70s)
pnpm benchmark              # corre todos los escenarios, imprime la tabla, escribe results/results.json
```

Un dataset pequeño para una mirada rápida: `SEED_SCALE=0.05 pnpm seed`.

## Metodología

- **Métrica:** mediana del `Execution Time` de PostgreSQL desde `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, 2 warm-ups + 7 corridas medidas ([ADR 0002](docs/adr/0002-warm-cache-median-execution-time.md)).
- **Caché caliente** es la elección _conservadora_: hace que la query "antes" se vea tan rápida como podría estar, así el speedup reportado es un piso.
- **Buffers** se reportan junto a cada tiempo como la prueba independiente de la máquina ([ADR 0003](docs/adr/0003-buffers-as-headline-metric.md)).
- **Settings del servidor** son modestos y se imprimen en cada corrida; los dos escenarios de spill ponen `work_mem` en su propio SQL, visiblemente, para ambos lados ([ADR 0004](docs/adr/0004-modest-documented-server-settings.md)).
- **Cada escenario verifica su cambio de plan** — la corrida falla si una optimización deja de hacer lo que afirma ([ADR 0005](docs/adr/0005-verify-the-plan-change.md)).
- **Totalmente reproducible:** el dataset se genera desde un hash con semilla, sin `random()`, sin descargas externas ([ADR 0001](docs/adr/0001-deterministic-seeded-hash-dataset.md)).

## Cómo está construido

| Pieza                                                                     | Dónde                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Los 15 escenarios (SQL lento, fix, teardown, aserción del cambio de plan) | [`src/scenarios.ts`](src/scenarios.ts)                                                     |
| Esquema + generador determinista por hash con semilla                     | [`sql/schema.sql`](sql/schema.sql), [`src/seed`](src/seed)                                 |
| Harness: warm-up, mediana, captura de EXPLAIN, verificación               | [`src/lib/benchmark.ts`](src/lib/benchmark.ts), [`src/lib/explain.ts`](src/lib/explain.ts) |
| Resultados registrados                                                    | [`results/results.json`](results/results.json)                                             |
| Decisiones de diseño (ADR-lite)                                           | [`docs/adr`](docs/adr)                                                                     |

El dataset tiene sesgo realista para que las optimizaciones sean significativas: el status es ~92% `DELIVERED` (un índice de una sola columna sobre él es _rechazado_ correctamente por el planner, que es justo el punto del escenario de índice parcial); `placed_at` es monótono con el id (correlación física > 0.999, lo que hace viable BRIN); `metadata` lleva una porción de ~0.8% `FREESHIP` en web para que el filtro JSONB sea genuinamente selectivo.

## Testing

```bash
pnpm test                  # suites unitarias (parsing de planes, estadística, integridad del catálogo)
docker compose up -d
pnpm test:integration      # harness contra Postgres real (auto-siembra pequeño, prueba un cambio de plan real)
```

CI corre las suites unitarias, el seeder y el test de integración en cada push. El benchmark a escala completa es local por diseño ([ADR 0006](docs/adr/0006-scale-aware-seed.md)): el planner elige planes distintos en una tabla pequeña, así que los números titulares vienen de un dataset real de 1.5M filas, no de CI.

## Salvedades honestas

Los milisegundos absolutos son de caché caliente y una sola máquina; variarán en tu hardware. Las afirmaciones durables y reproducibles son los **cambios de plan** y las **reducciones de buffers**, que son deterministas. Los speedups de point-lookup (1000×+) comparan un scan completo con un seek de índice — ese ratio es real pero esperable; los escenarios de agregación y BRIN/JSONB (3–16×) son las mejoras más "del día a día".

## Licencia

[MIT](LICENSE) © Efraín Hernández
