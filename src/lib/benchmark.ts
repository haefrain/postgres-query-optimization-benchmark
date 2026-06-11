import { DbClient } from './db';
import { ExplainRoot, PlanSummary, summarizePlan } from './explain';
import { Scenario } from './scenario';
import { median, percentFaster, speedup } from './stats';

export interface RunOptions {
  /** Measured repetitions whose median is reported. */
  runs: number;
  /** Unmeasured repetitions first, to reach a steady warm-cache state. */
  warmups: number;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = { runs: 7, warmups: 2 };

export interface Measurement {
  medianMs: number;
  runsMs: number[];
  summary: PlanSummary;
}

export interface BenchmarkResult {
  id: string;
  title: string;
  category: string;
  before: Measurement;
  after: Measurement;
  speedup: number;
  percentFaster: number;
  /** Result of scenario.verify, or null when the scenario defines none. */
  verified: boolean | null;
}

async function runAll(client: DbClient, statements: string[]): Promise<void> {
  for (const sql of statements) {
    await client.query(sql);
  }
}

/** Runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and returns the parsed root. */
async function explainAnalyze(client: DbClient, sql: string): Promise<ExplainRoot> {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const field = (result.rows[0] as Record<string, unknown>)['QUERY PLAN'];
  // node-pg already parses json columns; fall back to parsing a string.
  const arr = (typeof field === 'string' ? JSON.parse(field) : field) as ExplainRoot[];
  const root = arr[0];
  if (!root?.Plan || typeof root['Execution Time'] !== 'number') {
    throw new Error('EXPLAIN ANALYZE did not return an execution time');
  }
  return root;
}

async function measure(client: DbClient, sql: string, opts: RunOptions): Promise<Measurement> {
  for (let i = 0; i < opts.warmups; i += 1) {
    await explainAnalyze(client, sql);
  }
  const runsMs: number[] = [];
  let lastRoot: ExplainRoot | undefined;
  for (let i = 0; i < opts.runs; i += 1) {
    lastRoot = await explainAnalyze(client, sql);
    runsMs.push(lastRoot['Execution Time'] as number);
  }
  return { medianMs: median(runsMs), runsMs, summary: summarizePlan(lastRoot!) };
}

/**
 * Measures a scenario end-to-end: clean state, baseline (slow), apply fix,
 * optimized, then tear down. State is reset so scenarios are independent and
 * the whole catalog is re-runnable in any order.
 */
export async function runScenario(
  client: DbClient,
  scenario: Scenario,
  opts: RunOptions = DEFAULT_RUN_OPTIONS,
): Promise<BenchmarkResult> {
  // Start from a known-clean state in case a previous run left the fix behind.
  await runAll(client, scenario.teardownDdl);
  await runAll(client, scenario.sessionSql ?? []);

  try {
    const before = await measure(client, scenario.slowSql, opts);
    await runAll(client, scenario.fixDdl);
    const after = await measure(client, scenario.optimizedSql, opts);

    return {
      id: scenario.id,
      title: scenario.title,
      category: scenario.category,
      before,
      after,
      speedup: speedup(before.medianMs, after.medianMs),
      percentFaster: percentFaster(before.medianMs, after.medianMs),
      verified: scenario.verify ? scenario.verify(before.summary, after.summary) : null,
    };
  } finally {
    await runAll(client, scenario.teardownDdl);
    await client.query('RESET ALL');
  }
}
