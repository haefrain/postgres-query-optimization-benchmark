import { performance } from 'node:perf_hooks';

import { loadConfig } from '../lib/config';
import { withClient } from '../lib/db';
import { scaledCounts, seedDatabase, verify } from './seed';

// CLI entrypoint, separate from seed.ts so importing seedDatabase has zero
// side effects (a test importing it must never trigger a stray seed).
async function main(): Promise<void> {
  const { databaseUrl, seedScale } = loadConfig();
  console.log(
    `Seeding at scale ${seedScale} (orders target: ${scaledCounts(seedScale).orders.toLocaleString()})\n`,
  );
  const start = performance.now();
  await withClient(databaseUrl, async (client) => {
    await seedDatabase(client, seedScale);
    await verify(client);
  });
  console.log(`\nDone in ${Math.round((performance.now() - start) / 1000)}s.`);
}

void main();
