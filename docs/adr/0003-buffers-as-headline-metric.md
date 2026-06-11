# ADR 0003 — Buffers read as the machine-independent headline

**Status:** accepted

**Context.** Millisecond speedups (some over 1000×) invite skepticism: are they cache artifacts of a particular machine? Timings depend on CPU, cache and load.

**Decision.** Report **shared blocks accessed** (8 KB buffers hit + read), captured via `BUFFERS`, alongside every timing. The benchmark records it for the before and after plan of each scenario.

**Why.** Buffer counts are a property of the _plan_, not the hardware: a Seq Scan of 1.5M rows touches ~66,760 buffers on any machine; an index lookup of six rows touches ~18. That ratio is the real, reproducible evidence — the milliseconds merely track it. Reviewers who distrust a "1414×" can verify the 66,760 → 18 buffer drop themselves and reach the same conclusion.

**Consequences.** The README leads with buffer reductions next to timings, so the speedups are defensible rather than dazzling.
