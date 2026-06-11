export interface BenchmarkConfig {
  databaseUrl: string;
  /** Multiplier on the base row counts; 1 = full dataset. */
  seedScale: number;
}

/** Reads and validates runtime config, failing fast with a clear message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BenchmarkConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (see .env.example)');
  }

  const seedScale = Number(env.SEED_SCALE ?? '1');
  if (!Number.isFinite(seedScale) || seedScale <= 0) {
    throw new Error(`SEED_SCALE must be a positive number, got: ${env.SEED_SCALE}`);
  }

  return { databaseUrl, seedScale };
}
