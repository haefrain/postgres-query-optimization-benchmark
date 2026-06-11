import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../lib/config';
import { DbClient, withClient } from '../lib/db';
import {
  CITIES,
  CUISINES,
  FIRST_NAMES,
  LAST_NAMES,
  MENU_ITEMS,
  sqlTextArray,
  VEHICLES,
} from './pools';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

/** Restaurants and couriers stay fixed across scales; only customers and orders grow. */
export const FIXED = { restaurants: 2000, couriers: 5000 } as const;
export const BASE = { customers: 200_000, orders: 1_500_000 } as const;

/** The two-year window every time-based scenario assumes (kept constant at any scale). */
export const WINDOW_START = '2024-06-10 00:00:00+00';
export const WINDOW_SECONDS = 63_072_000; // 2 * 365 days

/** Fixtures pinned to low ids so they exist at any scale and scenario literals never change. */
export const FIXTURES = {
  uniqueNameCustomerId: 1001,
  uniqueName: 'Valentina Quispe-Marchetti',
  emailCustomerId: 1002,
  emailLower: 'user.1002@example.com',
  prefixFrom: 1003,
  prefixTo: 1012,
  prefixSearch: 'Aurelio',
} as const;

export interface SeedCounts {
  restaurants: number;
  customers: number;
  couriers: number;
  orders: number;
}

function scaledCounts(scale: number): SeedCounts {
  return {
    restaurants: FIXED.restaurants,
    couriers: FIXED.couriers,
    customers: Math.max(2000, Math.round(BASE.customers * scale)),
    orders: Math.max(1000, Math.round(BASE.orders * scale)),
  };
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  await fn();
  const ms = Math.round(performance.now() - start);
  console.log(`  ${label.padEnd(34)} ${ms.toLocaleString()} ms`);
}

export async function seedDatabase(client: DbClient, scale: number): Promise<SeedCounts> {
  const counts = scaledCounts(scale);
  const { restaurants, couriers, customers, orders } = counts;

  // Jitter must stay strictly below the per-row time step so placed_at is
  // monotonic with id and the BRIN scenario gets correlation > 0.999.
  const stepSeconds = WINDOW_SECONDS / orders;
  const jitterModMs = Math.max(1, Math.floor(stepSeconds * 1000 * 0.9));

  await step('schema', async () => {
    await client.query(readFileSync(join(repoRoot, 'sql', 'schema.sql'), 'utf8'));
  });

  await step('restaurants', async () => {
    await client.query(`
      INSERT INTO restaurants (id, name, city, cuisine)
      SELECT g.id,
             (cu.arr)[1 + (h(g.id, 'cuis') % array_length(cu.arr, 1))] || ' Place #' || g.id,
             (ci.arr)[1 + (h(g.id, 'city') % array_length(ci.arr, 1))],
             (cu.arr)[1 + (h(g.id, 'cuis') % array_length(cu.arr, 1))]
      FROM generate_series(1, ${restaurants}) AS g(id)
      CROSS JOIN (SELECT ${sqlTextArray(CUISINES)} AS arr) cu
      CROSS JOIN (SELECT ${sqlTextArray(CITIES)} AS arr) ci;
    `);
  });

  await step('couriers', async () => {
    await client.query(`
      INSERT INTO couriers (id, full_name, vehicle, active)
      SELECT g.id,
             (fn.arr)[1 + (h(g.id, 'cfn') % array_length(fn.arr, 1))] || ' ' ||
             (ln.arr)[1 + (h(g.id, 'cln') % array_length(ln.arr, 1))],
             (ve.arr)[1 + (h(g.id, 'veh') % array_length(ve.arr, 1))],
             (g.id % 10) <> 0
      FROM generate_series(1, ${couriers}) AS g(id)
      CROSS JOIN (SELECT ${sqlTextArray(FIRST_NAMES)} AS arr) fn
      CROSS JOIN (SELECT ${sqlTextArray(LAST_NAMES)} AS arr) ln
      CROSS JOIN (SELECT ${sqlTextArray(VEHICLES)} AS arr) ve;
    `);
  });

  await step('customers', async () => {
    await client.query(`
      INSERT INTO customers (id, full_name, email, city)
      SELECT g.id,
             (fn.arr)[1 + (h(g.id, 'fn') % array_length(fn.arr, 1))] || ' ' ||
             (ln.arr)[1 + (h(g.id, 'ln') % array_length(ln.arr, 1))],
             'User.' || g.id || '@Example.COM',
             (ci.arr)[1 + (h(g.id, 'ccity') % array_length(ci.arr, 1))]
      FROM generate_series(1, ${customers}) AS g(id)
      CROSS JOIN (SELECT ${sqlTextArray(FIRST_NAMES)} AS arr) fn
      CROSS JOIN (SELECT ${sqlTextArray(LAST_NAMES)} AS arr) ln
      CROSS JOIN (SELECT ${sqlTextArray(CITIES)} AS arr) ci;
    `);
  });

  await step('orders', async () => {
    // Everything is computed inline so each row is written exactly once, in id
    // order. (An earlier version UPDATEd delivered_at/metadata after insert,
    // which rewrote 92% of tuples and dropped placed_at correlation to ~0.67 —
    // fatal for the BRIN scenario. Single-write insert keeps it > 0.999.)
    await client.query(`
      INSERT INTO orders (id, customer_id, restaurant_id, courier_id, status, total_cents, currency, placed_at, delivered_at, metadata)
      SELECT g.id,
             1 + (h(g.id, 'cust') % ${customers}),
             1 + (h(g.id, 'rest') % ${restaurants}),
             CASE WHEN (h(g.id, 'curnull') % 100) < 5 THEN NULL
                  ELSE 1 + (h(g.id, 'cour') % ${couriers}) END,
             st.status,
             500 + (h(g.id, 'amt') % 14501),
             'USD',
             ts.placed_at,
             CASE WHEN st.status = 'DELIVERED'
                  THEN ts.placed_at + ((15 + (h(g.id, 'dl') % 76)) * interval '1 minute')
                  ELSE NULL END,
             jsonb_build_object('channel', ch.channel)
             || CASE
                  WHEN ch.channel = 'web' AND (h(g.id, 'promo') % 1000) < 16
                    THEN '{"promo_code":"FREESHIP"}'::jsonb
                  WHEN (h(g.id, 'promo2') % 1000) < 120
                    THEN jsonb_build_object('promo_code',
                           CASE WHEN h(g.id, 'promo2') % 2 = 0 THEN 'WELCOME10' ELSE 'SAVE5' END)
                  ELSE '{}'::jsonb
                END
      FROM generate_series(1, ${orders}) AS g(id)
      CROSS JOIN LATERAL (
        SELECT to_timestamp(
          extract(epoch FROM timestamptz '${WINDOW_START}')
          + (g.id - 1) * ${stepSeconds}
          + (h(g.id, 'jit') % ${jitterModMs}) / 1000.0
        ) AS placed_at
      ) ts
      CROSS JOIN LATERAL (
        SELECT CASE WHEN h(g.id, 'chan') % 2 = 0 THEN 'app' ELSE 'web' END AS channel
      ) ch
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN b <= 919 THEN 'DELIVERED'
          WHEN b <= 949 THEN 'DISPATCHED'
          WHEN b <= 964 THEN 'READY'
          WHEN b <= 979 THEN 'IN_PREPARATION'
          WHEN b <= 989 THEN 'ACCEPTED'
          WHEN b <= 994 THEN 'CANCELLED'
          ELSE 'REJECTED'
        END AS status
        FROM (SELECT h(g.id, 'status') % 1000 AS b) z
      ) st;
    `);
  });

  await step('order_items', async () => {
    await client.query(`
      INSERT INTO order_items (id, order_id, name, quantity, unit_price_cents)
      SELECT o.id * 8 + i.n,
             o.id,
             (mn.arr)[1 + (h(o.id * 8 + i.n, 'item') % array_length(mn.arr, 1))],
             1 + (h(o.id * 8 + i.n, 'qty') % 4),
             200 + (h(o.id * 8 + i.n, 'price') % 4801)
      FROM orders o
      CROSS JOIN (SELECT ${sqlTextArray(MENU_ITEMS)} AS arr) mn
      CROSS JOIN LATERAL generate_series(1, 1 + (h(o.id, 'cnt') % 5)) AS i(n);
    `);
  });

  await step('fixtures', async () => {
    await client.query(`UPDATE customers SET full_name = $1 WHERE id = $2;`, [
      FIXTURES.uniqueName,
      FIXTURES.uniqueNameCustomerId,
    ]);
    await client.query(
      `UPDATE customers SET full_name = '${FIXTURES.prefixSearch} Restrepo ' || id
       WHERE id BETWEEN ${FIXTURES.prefixFrom} AND ${FIXTURES.prefixTo};`,
    );
  });

  await step('baseline indexes', async () => {
    await client.query(`CREATE INDEX idx_orders_status ON orders (status);`);
    await client.query(`CREATE INDEX idx_customers_email ON customers (email);`);
  });

  await step('vacuum analyze', async () => {
    // Outside any transaction (node-pg autocommits each query). VACUUM keeps the
    // visibility map current so Index-Only Scan scenarios show Heap Fetches: 0.
    await client.query(`VACUUM (ANALYZE) restaurants, customers, couriers, orders, order_items;`);
  });

  return counts;
}

async function verify(client: DbClient): Promise<void> {
  const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
    (await client.query(sql)).rows;

  const tableCounts = await rows(`
    SELECT 'restaurants' t, count(*) n FROM restaurants
    UNION ALL SELECT 'customers', count(*) FROM customers
    UNION ALL SELECT 'couriers', count(*) FROM couriers
    UNION ALL SELECT 'orders', count(*) FROM orders
    UNION ALL SELECT 'order_items', count(*) FROM order_items;
  `);
  console.log('\nRow counts:');
  for (const r of tableCounts) {
    console.log(`  ${String(r.t).padEnd(14)} ${Number(r.n).toLocaleString()}`);
  }

  const [corr] = await rows(
    `SELECT correlation FROM pg_stats WHERE tablename = 'orders' AND attname = 'placed_at';`,
  );
  console.log(
    `\nplaced_at physical correlation: ${Number(corr?.correlation).toFixed(4)} (want > 0.999)`,
  );

  const statusDist = await rows(`
    SELECT status, count(*) n, round(100.0 * count(*) / sum(count(*)) OVER (), 2) pct
    FROM orders GROUP BY status ORDER BY n DESC;
  `);
  console.log('\nStatus distribution:');
  for (const r of statusDist) {
    console.log(`  ${String(r.status).padEnd(16)} ${String(r.pct).padStart(6)}%`);
  }

  const [freeship] = await rows(`
    SELECT count(*) n FROM orders WHERE metadata @> '{"promo_code":"FREESHIP","channel":"web"}';
  `);
  const [total] = await rows(`SELECT count(*) n FROM orders;`);
  const pct = (Number(freeship?.n) / Number(total?.n)) * 100;
  console.log(
    `\nFREESHIP+web orders: ${Number(freeship?.n).toLocaleString()} (${pct.toFixed(2)}%)`,
  );

  const [needle] = await rows(
    `SELECT count(*) n FROM customers WHERE full_name = '${FIXTURES.uniqueName}';`,
  );
  console.log(`Unique-name fixture matches: ${Number(needle?.n)} (want 1)`);

  const [r42] = await rows(`SELECT city FROM restaurants WHERE id = 42;`);
  console.log(`Restaurant 42 city: ${String(r42?.city)}`);
}

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
