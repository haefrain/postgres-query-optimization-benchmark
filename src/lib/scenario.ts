import type { PlanSummary } from './explain';

/**
 * One optimization case: a realistic slow query and the change that fixes it.
 * The harness runs `slowSql`, applies `fixDdl`, runs `optimizedSql`, then
 * `teardownDdl` to reset — so scenarios are independent and re-runnable.
 */
export interface Scenario {
  id: string;
  title: string;
  category: string;
  /** The real-world question the query answers. */
  businessQuestion: string;
  slowSql: string;
  /** May be identical to slowSql when the fix is purely an index. */
  optimizedSql: string;
  /** DDL that enables the optimization (e.g. CREATE INDEX ...). */
  fixDdl: string[];
  /** DDL that undoes fixDdl so the next run starts clean. */
  teardownDdl: string[];
  /** Human-readable description of the plan change that proves the win. */
  planChangeToVerify: string;
  expectedImpact: string;
  /**
   * Session-level statements applied before measuring BOTH queries so the
   * comparison is fair (e.g. `SET work_mem='4MB'` to make a sort spill
   * reproducible regardless of server defaults).
   */
  sessionSql?: string[];
  /**
   * Asserts the optimization actually happened by inspecting the real plans.
   * Returning false means the scenario did not deliver its promised change —
   * a hard failure, not a slow result.
   */
  verify?: (before: PlanSummary, after: PlanSummary) => boolean;
}
