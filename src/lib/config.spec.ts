import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

describe('loadConfig', () => {
  it('reads database url and defaults seed scale to 1', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://x/y' });
    expect(config.databaseUrl).toBe('postgresql://x/y');
    expect(config.seedScale).toBe(1);
  });

  it('parses an explicit seed scale', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://x/y', SEED_SCALE: '0.02' });
    expect(config.seedScale).toBe(0.02);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL is required/);
  });

  it('rejects a non-positive seed scale', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://x/y', SEED_SCALE: '0' })).toThrow(
      /SEED_SCALE/,
    );
  });
});
