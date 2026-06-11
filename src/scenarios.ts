import { Scenario } from './lib/scenario';

/**
 * The optimization catalog. Each scenario is a realistic slow query plus the
 * idiomatic PostgreSQL fix, ordered roughly fundamentals -> advanced. Every
 * `verify` asserts the real plan change so a scenario that stops delivering
 * its promise fails loudly instead of silently posting a flat number.
 *
 * Literals are pinned to the deterministic seed (see src/seed): customer 137042
 * and 4242 exist with a handful of orders, restaurant 42 is in 'Tunja',
 * customer 184523's email is mixed-case, customers 1003-1012 start with
 * 'Aurelio', customer 1001 has the near-unique name searched by trigram, and
 * ~0.8% of orders carry FREESHIP on the web channel.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'missing-btree-orders-by-customer',
    title: 'A missing index turns a customer lookup into a full-table scan',
    category: 'Indexing fundamentals',
    businessQuestion:
      'Every order one customer has placed, newest first (support / profile screen).',
    slowSql:
      'SELECT id, restaurant_id, status, total_cents, placed_at FROM orders WHERE customer_id = 137042 ORDER BY placed_at DESC',
    optimizedSql:
      'SELECT id, restaurant_id, status, total_cents, placed_at FROM orders WHERE customer_id = 137042 ORDER BY placed_at DESC',
    fixDdl: ['CREATE INDEX idx_orders_customer_id ON orders (customer_id)', 'ANALYZE orders'],
    teardownDdl: ['DROP INDEX IF EXISTS idx_orders_customer_id'],
    planChangeToVerify: 'Seq Scan on orders -> Index Scan using idx_orders_customer_id',
    expectedImpact: 'Full-table scan of 1.5M rows collapses to an index lookup of a handful.',
    verify: (b, a) =>
      b.usesSeqScan && !a.usesSeqScan && a.indexesUsed.includes('idx_orders_customer_id'),
  },
  {
    id: 'function-on-placed-at-defeats-index',
    title: 'A function on an indexed column defeats the index (sargability)',
    category: 'Anti-patterns',
    businessQuestion: 'How many orders, and what revenue, on one calendar day (ops dashboard)?',
    sessionSql: ["SET TimeZone = 'UTC'"],
    slowSql:
      "SELECT count(*), sum(total_cents) FROM orders WHERE date(placed_at) = DATE '2025-03-15'",
    optimizedSql:
      "SELECT count(*), sum(total_cents) FROM orders WHERE placed_at >= timestamptz '2025-03-15 00:00:00+00' AND placed_at < timestamptz '2025-03-16 00:00:00+00'",
    fixDdl: ['CREATE INDEX idx_orders_placed_at ON orders (placed_at)', 'ANALYZE orders'],
    teardownDdl: ['DROP INDEX IF EXISTS idx_orders_placed_at'],
    planChangeToVerify:
      'date(placed_at) Seq Scan -> sargable half-open range Index Scan using idx_orders_placed_at',
    expectedImpact:
      'Wrapping the column in date() blocks the index; a half-open range restores it.',
    verify: (b, a) =>
      b.usesSeqScan && !a.usesSeqScan && a.indexesUsed.includes('idx_orders_placed_at'),
  },
  {
    id: 'expression-index-lower-email-login',
    title: 'Case-insensitive email lookup needs an expression index',
    category: 'Indexing fundamentals',
    businessQuestion: 'Find an account by email, case-insensitively (login / account search).',
    slowSql:
      "SELECT id, full_name, email, city FROM customers WHERE lower(email) = lower('User.184523@Example.com')",
    optimizedSql:
      "SELECT id, full_name, email, city FROM customers WHERE lower(email) = lower('User.184523@Example.com')",
    fixDdl: [
      'CREATE INDEX idx_customers_lower_email ON customers (lower(email))',
      'ANALYZE customers',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_customers_lower_email'],
    planChangeToVerify: 'Seq Scan on customers -> Index Scan using idx_customers_lower_email',
    expectedImpact: 'A plain email index cannot serve lower(email)=...; the expression index can.',
    verify: (b, a) =>
      b.usesSeqScan && !a.usesSeqScan && a.indexesUsed.includes('idx_customers_lower_email'),
  },
  {
    id: 'prefix-like-text-pattern-ops',
    title: "Anchored LIKE 'prefix%' served by a text_pattern_ops index",
    category: 'Indexing fundamentals',
    businessQuestion: 'Type-ahead search: customers whose name starts with a typed prefix.',
    slowSql:
      "SELECT id, full_name, email, city FROM customers WHERE full_name LIKE 'Aurelio%' ORDER BY full_name LIMIT 50",
    optimizedSql:
      "SELECT id, full_name, email, city FROM customers WHERE full_name LIKE 'Aurelio%' ORDER BY full_name LIMIT 50",
    fixDdl: [
      'CREATE INDEX idx_customers_full_name_pattern ON customers (full_name text_pattern_ops)',
      'ANALYZE customers',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_customers_full_name_pattern'],
    planChangeToVerify:
      'Seq Scan on customers -> Index Scan using idx_customers_full_name_pattern (prefix range)',
    expectedImpact: 'text_pattern_ops compares byte-by-byte so an anchored prefix becomes a range.',
    verify: (b, a) => b.usesSeqScan && a.indexesUsed.includes('idx_customers_full_name_pattern'),
  },
  {
    id: 'partial-index-active-orders-dashboard',
    title: 'A partial index for the rare rows an ops dashboard actually wants',
    category: 'Partial & covering indexes',
    businessQuestion: 'Most recent orders still needing attention (everything not yet DELIVERED).',
    slowSql:
      "SELECT id, customer_id, restaurant_id, status, total_cents, placed_at FROM orders WHERE status <> 'DELIVERED' ORDER BY placed_at DESC LIMIT 50",
    optimizedSql:
      "SELECT id, customer_id, restaurant_id, status, total_cents, placed_at FROM orders WHERE status <> 'DELIVERED' ORDER BY placed_at DESC LIMIT 50",
    fixDdl: [
      "CREATE INDEX idx_orders_active_placed_at ON orders (placed_at DESC) WHERE status <> 'DELIVERED'",
      'ANALYZE orders',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_orders_active_placed_at'],
    planChangeToVerify:
      'Seq Scan + Sort -> Index Scan using idx_orders_active_placed_at, no Sort node',
    expectedImpact: 'The partial index excludes 92% of rows and is pre-sorted for the ORDER BY.',
    verify: (b, a) =>
      b.usesSeqScan &&
      a.indexesUsed.includes('idx_orders_active_placed_at') &&
      !a.nodeTypes.includes('Sort'),
  },
  {
    id: 'composite-covering-restaurant-recent-orders',
    title: 'A covering composite index gives an Index-Only Scan (Heap Fetches: 0)',
    category: 'Partial & covering indexes',
    businessQuestion: "A restaurant's 20 most recent delivered orders, newest first.",
    slowSql:
      "SELECT id, placed_at, total_cents FROM orders WHERE restaurant_id = 42 AND status = 'DELIVERED' ORDER BY placed_at DESC LIMIT 20",
    optimizedSql:
      "SELECT id, placed_at, total_cents FROM orders WHERE restaurant_id = 42 AND status = 'DELIVERED' ORDER BY placed_at DESC LIMIT 20",
    fixDdl: [
      'CREATE INDEX idx_orders_rest_status_placed_cov ON orders (restaurant_id, status, placed_at DESC) INCLUDE (id, total_cents)',
      'VACUUM (ANALYZE) orders',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_orders_rest_status_placed_cov'],
    planChangeToVerify: 'Seq Scan + top-N Sort -> Index Only Scan (Heap Fetches: 0), no Sort node',
    expectedImpact:
      'Equality keys lead, placed_at DESC matches ORDER BY, INCLUDE avoids heap fetches.',
    verify: (_b, a) => a.nodeTypes.includes('Index Only Scan') && !a.nodeTypes.includes('Sort'),
  },
  {
    id: 'keyset-pagination-deep-offset',
    title: 'Deep OFFSET pagination vs keyset (seek) pagination',
    category: 'Anti-patterns',
    businessQuestion: 'Page deep into the delivered-orders feed (page ~2001, 50 per page).',
    slowSql:
      "SELECT id, placed_at, total_cents FROM orders WHERE status = 'DELIVERED' ORDER BY placed_at DESC, id DESC LIMIT 50 OFFSET 100000",
    optimizedSql:
      "SELECT id, placed_at, total_cents FROM orders WHERE status = 'DELIVERED' AND (placed_at, id) < (timestamptz '2026-04-18 00:00:00+00', 1391305) ORDER BY placed_at DESC, id DESC LIMIT 50",
    fixDdl: [
      'CREATE INDEX idx_orders_status_placed_id ON orders (status, placed_at DESC, id DESC)',
      'ANALYZE orders',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_orders_status_placed_id'],
    planChangeToVerify:
      'OFFSET discards 100k rows -> keyset seeks straight to ~50 rows via idx_orders_status_placed_id',
    expectedImpact: 'OFFSET cost grows with page depth; keyset is flat regardless of depth.',
    verify: (b, a) =>
      a.indexesUsed.includes('idx_orders_status_placed_id') &&
      a.sharedBlocksAccessed < b.sharedBlocksAccessed,
  },
  {
    id: 'or-predicate-to-union-all',
    title: 'An OR across two columns defeats a single index; UNION ALL fixes it',
    category: 'Anti-patterns',
    businessQuestion: 'Orders placed by a given customer OR delivered by a given courier.',
    slowSql:
      'SELECT id, customer_id, courier_id, status, total_cents, placed_at FROM orders WHERE customer_id = 4242 OR courier_id = 1234 ORDER BY placed_at DESC',
    optimizedSql:
      'SELECT id, customer_id, courier_id, status, total_cents, placed_at FROM orders WHERE customer_id = 4242 ' +
      'UNION ALL ' +
      'SELECT id, customer_id, courier_id, status, total_cents, placed_at FROM orders WHERE courier_id = 1234 AND customer_id <> 4242 ' +
      'ORDER BY placed_at DESC',
    fixDdl: [
      'CREATE INDEX idx_orders_customer_id ON orders (customer_id)',
      'CREATE INDEX idx_orders_courier_id ON orders (courier_id)',
      'ANALYZE orders',
    ],
    teardownDdl: [
      'DROP INDEX IF EXISTS idx_orders_customer_id',
      'DROP INDEX IF EXISTS idx_orders_courier_id',
    ],
    planChangeToVerify: 'Seq Scan with OR filter -> Append of two index scans',
    expectedImpact: 'A cross-column OR cannot use one index; two branches each use their own.',
    verify: (b, a) => b.usesSeqScan && !a.usesSeqScan && a.nodeTypes.includes('Append'),
  },
  {
    id: 'nplus1-join-missing-fk-index',
    title: 'N+1 collapsed into a JOIN — and the FK index that makes it a Nested Loop',
    category: 'Joins',
    businessQuestion: "A customer's order history with every line item per order.",
    slowSql:
      'SELECT o.id AS order_id, o.status, o.placed_at, o.total_cents, oi.name, oi.quantity, oi.unit_price_cents ' +
      'FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.customer_id = 4242 ORDER BY o.placed_at DESC, o.id',
    optimizedSql:
      'SELECT o.id AS order_id, o.status, o.placed_at, o.total_cents, oi.name, oi.quantity, oi.unit_price_cents ' +
      'FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.customer_id = 4242 ORDER BY o.placed_at DESC, o.id',
    fixDdl: [
      'CREATE INDEX idx_order_items_order_id ON order_items (order_id)',
      'CREATE INDEX idx_orders_customer_id ON orders (customer_id)',
      'ANALYZE order_items',
      'ANALYZE orders',
    ],
    teardownDdl: [
      'DROP INDEX IF EXISTS idx_order_items_order_id',
      'DROP INDEX IF EXISTS idx_orders_customer_id',
    ],
    planChangeToVerify:
      'Dual Seq Scan Hash Join -> Nested Loop of index scans (Postgres does not auto-index FKs)',
    expectedImpact: 'Without an order_items(order_id) index each join probe scans all 4.5M items.',
    verify: (b, a) =>
      b.usesSeqScan && !a.usesSeqScan && a.indexesUsed.includes('idx_order_items_order_id'),
  },
  {
    id: 'not-in-nullable-to-not-exists',
    title: 'NOT IN over a nullable column returns wrong results; NOT EXISTS fixes it',
    category: 'Anti-patterns',
    businessQuestion: 'Active couriers never assigned to a cancelled or rejected order.',
    slowSql:
      "SELECT c.id, c.full_name FROM couriers c WHERE c.active = true AND c.id NOT IN (SELECT o.courier_id FROM orders o WHERE o.status IN ('CANCELLED','REJECTED'))",
    optimizedSql:
      "SELECT c.id, c.full_name FROM couriers c WHERE c.active = true AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.courier_id = c.id AND o.status IN ('CANCELLED','REJECTED'))",
    fixDdl: [
      "CREATE INDEX idx_orders_status_courier ON orders (status, courier_id) WHERE status IN ('CANCELLED','REJECTED')",
      'ANALYZE orders',
      'ANALYZE couriers',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_orders_status_courier'],
    planChangeToVerify:
      'NOT IN returns 0 rows (wrong, NULL courier_id poisons the set) -> NOT EXISTS anti-join returns the correct non-empty set',
    expectedImpact:
      'A correctness bug first, a performance win second — NULLs make NOT IN return nothing.',
    verify: (b, a) => b.topActualRows === 0 && (a.topActualRows ?? 0) > 0,
  },
  {
    id: 'trigram-gin-ilike-name-search',
    title: 'Leading-wildcard ILIKE search served by a trigram GIN index',
    category: 'Full-text & JSONB',
    businessQuestion: 'Back-office search by any fragment of a customer name.',
    slowSql:
      "SELECT id, full_name, email, city FROM customers WHERE full_name ILIKE '%Valentina Quispe-Marchetti%' ORDER BY full_name LIMIT 50",
    optimizedSql:
      "SELECT id, full_name, email, city FROM customers WHERE full_name ILIKE '%Valentina Quispe-Marchetti%' ORDER BY full_name LIMIT 50",
    fixDdl: [
      'CREATE INDEX idx_customers_full_name_trgm ON customers USING gin (full_name gin_trgm_ops)',
      'ANALYZE customers',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_customers_full_name_trgm'],
    planChangeToVerify:
      'Seq Scan with ILIKE filter -> Bitmap Index Scan on idx_customers_full_name_trgm',
    expectedImpact: 'A B-tree cannot serve a leading wildcard; a trigram GIN index can.',
    verify: (b, a) => b.usesSeqScan && a.indexesUsed.includes('idx_customers_full_name_trgm'),
  },
  {
    id: 'jsonb-gin-containment-promo-filter',
    title: 'JSONB containment filter served by a GIN index',
    category: 'Full-text & JSONB',
    businessQuestion:
      'Recent web-channel orders that redeemed the FREESHIP promo (campaign reach).',
    slowSql:
      'SELECT id, customer_id, restaurant_id, status, total_cents, placed_at FROM orders ' +
      `WHERE metadata @> '{"promo_code":"FREESHIP","channel":"web"}' ORDER BY placed_at DESC LIMIT 100`,
    optimizedSql:
      'SELECT id, customer_id, restaurant_id, status, total_cents, placed_at FROM orders ' +
      `WHERE metadata @> '{"promo_code":"FREESHIP","channel":"web"}' ORDER BY placed_at DESC LIMIT 100`,
    fixDdl: [
      'CREATE INDEX idx_orders_metadata_gin ON orders USING gin (metadata jsonb_path_ops)',
      'ANALYZE orders',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_orders_metadata_gin'],
    planChangeToVerify: 'Seq Scan with @> filter -> Bitmap Index Scan on idx_orders_metadata_gin',
    expectedImpact:
      'A jsonb_path_ops GIN index turns a containment scan of 1.5M rows into a lookup.',
    verify: (b, a) => b.usesSeqScan && a.indexesUsed.includes('idx_orders_metadata_gin'),
  },
  {
    id: 'brin-time-range-revenue',
    title: 'A BRIN index: tiny footprint for time-range scans on append-only data',
    category: 'Specialized indexes',
    businessQuestion: 'Order volume and revenue for a calendar quarter, across the whole book.',
    slowSql:
      "SELECT count(*) AS orders_in_window, sum(total_cents) AS gross_revenue_cents FROM orders WHERE placed_at >= timestamptz '2025-01-01 00:00:00+00' AND placed_at < timestamptz '2025-04-01 00:00:00+00'",
    optimizedSql:
      "SELECT count(*) AS orders_in_window, sum(total_cents) AS gross_revenue_cents FROM orders WHERE placed_at >= timestamptz '2025-01-01 00:00:00+00' AND placed_at < timestamptz '2025-04-01 00:00:00+00'",
    fixDdl: [
      'CREATE INDEX idx_orders_placed_at_brin ON orders USING brin (placed_at) WITH (pages_per_range = 128)',
      'ANALYZE orders',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_orders_placed_at_brin'],
    planChangeToVerify: 'Seq Scan -> Bitmap Heap Scan via Bitmap Index Scan on the BRIN index',
    expectedImpact:
      'On time-ordered data a BRIN index prunes the scan at a fraction of a B-tree size.',
    verify: (b, a) => b.usesSeqScan && a.indexesUsed.includes('idx_orders_placed_at_brin'),
  },
  {
    id: 'distinct-on-latest-per-customer',
    title: 'Latest order per customer: external-merge sort vs DISTINCT ON over a covering index',
    category: 'Aggregation',
    businessQuestion: "Each customer's most recent order (retention dashboard).",
    sessionSql: ["SET work_mem = '4MB'"],
    slowSql:
      'SELECT DISTINCT ON (customer_id) customer_id, id AS last_order_id, placed_at, total_cents FROM orders ORDER BY customer_id, placed_at DESC, id DESC',
    optimizedSql:
      'SELECT DISTINCT ON (customer_id) customer_id, id AS last_order_id, placed_at, total_cents FROM orders ORDER BY customer_id, placed_at DESC, id DESC',
    fixDdl: [
      'CREATE INDEX idx_orders_customer_placed_id_cov ON orders (customer_id, placed_at DESC, id DESC) INCLUDE (total_cents)',
      'VACUUM (ANALYZE) orders',
    ],
    teardownDdl: ['DROP INDEX IF EXISTS idx_orders_customer_placed_id_cov'],
    planChangeToVerify:
      'Unique over an external-merge Sort (Disk) -> Unique over Index Only Scan, no Sort, no temp files',
    expectedImpact:
      'The pre-ordered covering index lets DISTINCT ON emit one row per group with no sort.',
    verify: (b, a) => b.usesDiskSort && !a.usesDiskSort && a.nodeTypes.includes('Index Only Scan'),
  },
  {
    id: 'materialized-view-daily-revenue',
    title: 'A dashboard re-aggregating 2 years on every load vs a materialized-view rollup',
    category: 'Aggregation',
    businessQuestion: 'Top revenue days per restaurant (leaderboard recomputed on every load).',
    sessionSql: ["SET work_mem = '4MB'"],
    slowSql:
      "SELECT o.restaurant_id, date_trunc('day', o.placed_at) AS day, sum(o.total_cents) AS revenue_cents FROM orders o WHERE o.status = 'DELIVERED' GROUP BY o.restaurant_id, date_trunc('day', o.placed_at) ORDER BY revenue_cents DESC LIMIT 20",
    optimizedSql:
      'SELECT restaurant_id, day, revenue_cents FROM mv_daily_revenue_by_restaurant ORDER BY revenue_cents DESC LIMIT 20',
    fixDdl: [
      "CREATE MATERIALIZED VIEW mv_daily_revenue_by_restaurant AS SELECT o.restaurant_id, date_trunc('day', o.placed_at) AS day, count(*) AS delivered_orders, sum(o.total_cents) AS revenue_cents FROM orders o WHERE o.status = 'DELIVERED' GROUP BY o.restaurant_id, date_trunc('day', o.placed_at) WITH DATA",
      'CREATE UNIQUE INDEX idx_mv_daily_rev_pk ON mv_daily_revenue_by_restaurant (restaurant_id, day)',
      'ANALYZE mv_daily_revenue_by_restaurant',
    ],
    teardownDdl: ['DROP MATERIALIZED VIEW IF EXISTS mv_daily_revenue_by_restaurant'],
    planChangeToVerify:
      'Seq Scan on orders + spilling HashAggregate -> read of the small pre-aggregated rollup',
    expectedImpact:
      'A precomputed rollup turns a full re-aggregation into reading a few hundred-k small rows.',
    verify: (b, a) =>
      b.relationsSeqScanned.includes('orders') && !a.relationsSeqScanned.includes('orders'),
  },
];
