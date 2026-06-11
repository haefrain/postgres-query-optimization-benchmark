# ADR 0001 — Deterministic dataset from a seeded hash

**Status:** accepted

**Context.** The whole pitch is _reproducible_ evidence. A dataset built with `random()` would differ every run, so nobody could reproduce a number or trust a fixture (the near-unique name, the 0.8% promo slice, the time ordering BRIN needs).

**Decision.** Every value derives from a seeded 32-bit hash of the row id: `h(n, salt) = ('x' || substr(md5(salt || n), 1, 8))::bit(32)::bigint`. Categorical picks are `h(id, salt) % cardinality`; the dataset is generated with `generate_series` + `INSERT ... SELECT`, no external downloads, no `random()`, no `now()`.

**Consequences.** `pnpm seed` produces byte-identical data anywhere. Fixtures (customer 1001's unique name, restaurant 42's city, the FREESHIP slice) are stable, so scenario literals never drift. The seed is also scale-aware (see [0006](0006-scale-aware-seed.md)).
