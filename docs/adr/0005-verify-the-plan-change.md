# ADR 0005 — Every scenario asserts its plan change

**Status:** accepted

**Context.** A faster time alone doesn't prove the _intended_ optimization happened — a query can speed up for an unrelated reason (caching, a different plan), and a "covering index" scenario that silently falls back to a bitmap scan would still post a number.

**Decision.** Each scenario carries a `verify(before, after)` predicate over the parsed plans, asserting the specific change: Seq Scan → Index Scan, an `Index Only Scan` appearing, a disk sort disappearing, an `Append` of two index scans, or — for the NOT IN case — the row count going from 0 (wrong) to N (correct). The runner records the verdict; the CLI exits non-zero if any scenario fails to verify.

**Consequences.** The catalog can't rot into "fast but for the wrong reason." A scenario that stops delivering its lesson fails loudly. See `src/scenarios.ts` for the predicates and `src/lib/explain.ts` for the plan facts they read.
