import { describe, expect, it } from 'vitest';

import { SCENARIOS } from './scenarios';

describe('scenario catalog', () => {
  it('has a healthy number of scenarios', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(12);
  });

  it('uses unique ids', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every scenario is structurally complete', () => {
    for (const s of SCENARIOS) {
      expect(s.slowSql.trim().length).toBeGreaterThan(0);
      expect(s.optimizedSql.trim().length).toBeGreaterThan(0);
      expect(s.fixDdl.length).toBeGreaterThan(0);
      expect(s.teardownDdl.length).toBeGreaterThan(0);
      expect(typeof s.verify).toBe('function');
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.category.length).toBeGreaterThan(0);
    }
  });

  it('every fix is fully torn down (allowing for MV-index drop cascade)', () => {
    for (const s of SCENARIOS) {
      const createdViews = new Set(
        s.fixDdl
          .map((d) => /CREATE MATERIALIZED VIEW (\w+)/i.exec(d)?.[1])
          .filter((name): name is string => Boolean(name)),
      );
      const dropped = s.teardownDdl.join(' ');
      for (const ddl of s.fixDdl) {
        const index = /CREATE (?:UNIQUE )?INDEX (\w+) ON (\w+)/i.exec(ddl);
        if (index) {
          const [, name, onObject] = index;
          // An index on a dropped materialized view is removed by the cascade.
          if (onObject && createdViews.has(onObject)) continue;
          expect(dropped).toContain(name);
          continue;
        }
        const other = /CREATE (?:MATERIALIZED VIEW|STATISTICS) (\w+)/i.exec(ddl);
        if (other?.[1]) expect(dropped).toContain(other[1]);
      }
    }
  });
});
