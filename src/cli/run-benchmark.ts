import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BenchmarkResult, runScenario } from '../lib/benchmark';
import { loadConfig } from '../lib/config';
import { withClient } from '../lib/db';
import { SCENARIOS } from '../scenarios';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const fmtMs = (ms: number): string => (ms >= 100 ? ms.toFixed(0) : ms.toFixed(1));

async function captureEnvironment(
  query: (sql: string) => Promise<Record<string, unknown>[]>,
): Promise<Record<string, string>> {
  const [version] = await query('SHOW server_version');
  const settings: Record<string, string> = {};
  for (const name of ['shared_buffers', 'work_mem', 'effective_cache_size', 'random_page_cost']) {
    const [row] = await query(`SHOW ${name}`);
    settings[name] = String(row?.[name]);
  }
  const [counts] = await query('SELECT count(*) AS orders FROM orders');
  return {
    postgres: String(version?.server_version),
    orders: String(counts?.orders),
    ...settings,
  };
}

async function main(): Promise<void> {
  const { databaseUrl } = loadConfig();

  await withClient(databaseUrl, async (client) => {
    const query = async (sql: string): Promise<Record<string, unknown>[]> =>
      (await client.query(sql)).rows;

    const environment = await captureEnvironment(query);
    console.log(
      `PostgreSQL ${environment.postgres} | ${Number(environment.orders).toLocaleString()} orders | ` +
        `shared_buffers=${environment.shared_buffers} work_mem=${environment.work_mem}\n`,
    );

    const header = `${'#'.padStart(2)}  ${'scenario'.padEnd(38)} ${'before'.padStart(9)} ${'after'.padStart(9)} ${'speedup'.padStart(9)}  verify`;
    console.log(header);
    console.log('-'.repeat(header.length));

    const results: BenchmarkResult[] = [];
    for (const [i, scenario] of SCENARIOS.entries()) {
      const result = await runScenario(client, scenario);
      results.push(result);
      const mark = result.verified === null ? '—' : result.verified ? 'PASS' : 'FAIL';
      console.log(
        `${String(i + 1).padStart(2)}  ${scenario.id.padEnd(38)} ` +
          `${fmtMs(result.before.medianMs).padStart(7)}ms ${fmtMs(result.after.medianMs).padStart(7)}ms ` +
          `${(result.speedup.toFixed(1) + 'x').padStart(9)}  ${mark}`,
      );
    }

    const report = {
      environment,
      results: results.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        speedup: r.speedup,
        percentFaster: r.percentFaster,
        verified: r.verified,
        before: { medianMs: r.before.medianMs, summary: r.before.summary },
        after: { medianMs: r.after.medianMs, summary: r.after.summary },
      })),
    };
    mkdirSync(join(repoRoot, 'results'), { recursive: true });
    writeFileSync(join(repoRoot, 'results', 'results.json'), JSON.stringify(report, null, 2));

    const failed = results.filter((r) => r.verified === false);
    console.log(`\nWrote results/results.json (${results.length} scenarios).`);
    if (failed.length > 0) {
      console.log(
        `\n${failed.length} scenario(s) did NOT verify: ${failed.map((r) => r.id).join(', ')}`,
      );
      process.exitCode = 1;
    }
  });
}

void main();
