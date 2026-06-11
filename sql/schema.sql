-- Delivery-orders schema for the optimization benchmark.
-- Idempotent: drops and recreates everything so `pnpm seed` is repeatable.
--
-- Deliberate choices that the scenarios depend on:
--   * Foreign keys carry REFERENCES (which do NOT create indexes in Postgres),
--     so "missing FK index" lessons stay valid.
--   * status is plain text (not an enum) for portable seed/partial-index DDL.
--   * metadata is jsonb NOT NULL DEFAULT '{}' so the GIN containment scenario
--     always has a value to index.

DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS couriers CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS restaurants CASCADE;
DROP FUNCTION IF EXISTS h(bigint, text);

-- pg_trgm backs the trigram GIN scenario; created once at schema time.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Seeded 32-bit hash: deterministic pseudo-randomness derived purely from a
-- row id and a salt, so the entire dataset is 100% reproducible with no
-- external data and no Math.random/now() drift.
CREATE FUNCTION h(n bigint, salt text) RETURNS bigint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT ('x' || substr(md5(salt || n::text), 1, 8))::bit(32)::bigint $$;

CREATE TABLE restaurants (
  id         integer     PRIMARY KEY,
  name       text        NOT NULL,
  city       text        NOT NULL,
  cuisine    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id         integer     PRIMARY KEY,
  full_name  text        NOT NULL,
  email      text        NOT NULL,
  city       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE couriers (
  id         integer     PRIMARY KEY,
  full_name  text        NOT NULL,
  vehicle    text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id            bigint      PRIMARY KEY,
  customer_id   integer     NOT NULL REFERENCES customers(id),
  restaurant_id integer     NOT NULL REFERENCES restaurants(id),
  courier_id    integer     NULL     REFERENCES couriers(id),
  status        text        NOT NULL,
  total_cents   integer     NOT NULL,
  currency      text        NOT NULL DEFAULT 'USD',
  placed_at     timestamptz NOT NULL,
  delivered_at  timestamptz NULL,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id               bigint  PRIMARY KEY,
  order_id         bigint  NOT NULL REFERENCES orders(id),
  name             text    NOT NULL,
  quantity         integer NOT NULL,
  unit_price_cents integer NOT NULL
);
