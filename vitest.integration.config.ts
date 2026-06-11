import { defineConfig } from 'vitest/config';

// Integration suites talk to a real PostgreSQL (DATABASE_URL). A single fork
// runs them serially so they never clobber each other's database state.
export default defineConfig({
  test: {
    include: ['**/*.int-spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
