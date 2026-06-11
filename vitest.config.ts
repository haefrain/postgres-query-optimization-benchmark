import { configDefaults, defineConfig } from 'vitest/config';

// Default `pnpm test` runs fast unit suites only. Integration suites
// (*.int-spec.ts) need a real database and run via vitest.integration.config.ts.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.int-spec.ts'],
  },
});
