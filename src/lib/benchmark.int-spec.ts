import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedDatabase } from '../seed/seed';
import { runScenario } from './benchmark';
import { loadConfig } from './config';
import { Scenario } from './scenario';

describe('runScenario (integration, real Postgres)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const { databaseUrl } = loadConfig();
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    // Self-seed a small dataset so the suite is independent of prior state.
    await seedDatabase(client, 0.02);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('measures a missing-index scenario and proves the Seq Scan -> Index Scan change', async () => {
    const scenario: Scenario = {
      id: 'test-missing-btree',
      title: 'Orders for one customer without an index',
      category: 'missing-btree',
      businessQuestion: "A customer's recent orders.",
      slowSql:
        'SELECT id, status, total_cents FROM orders WHERE customer_id = 42 ORDER BY placed_at DESC',
      optimizedSql:
        'SELECT id, status, total_cents FROM orders WHERE customer_id = 42 ORDER BY placed_at DESC',
      fixDdl: ['CREATE INDEX idx_orders_customer_id ON orders (customer_id)'],
      teardownDdl: ['DROP INDEX IF EXISTS idx_orders_customer_id'],
      planChangeToVerify: 'Seq Scan on orders -> Index Scan using idx_orders_customer_id',
      expectedImpact: 'seq scan -> index scan',
      verify: (before, after) => before.usesSeqScan && !after.usesSeqScan,
    };

    const result = await runScenario(client, scenario, { runs: 3, warmups: 1 });

    expect(result.before.summary.usesSeqScan).toBe(true);
    expect(result.after.summary.usesSeqScan).toBe(false);
    expect(result.after.summary.indexesUsed).toContain('idx_orders_customer_id');
    expect(result.verified).toBe(true);
    expect(Number.isFinite(result.before.medianMs)).toBe(true);
    expect(result.speedup).toBeGreaterThan(0);

    // Teardown must leave no trace, so scenarios stay independent.
    const leftover = await client.query(
      "SELECT 1 FROM pg_indexes WHERE indexname = 'idx_orders_customer_id'",
    );
    expect(leftover.rowCount).toBe(0);
  });
});
