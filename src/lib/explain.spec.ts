import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { flattenNodes, parseExplainJson, summarizePlan } from './explain';

const here = dirname(fileURLToPath(import.meta.url));
// Fixtures are real `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` output captured from
// PostgreSQL 16, so the parser is tested against the planner's actual shape.
const fixture = (name: string): string => readFileSync(join(here, '__fixtures__', name), 'utf8');

describe('parseExplainJson', () => {
  it('returns the root plan node', () => {
    const root = parseExplainJson(fixture('plan-memory-sort.json'));
    expect(root.Plan['Node Type']).toBe('Sort');
    expect(root['Execution Time']).toBeCloseTo(9.511, 1);
  });

  it('throws on an empty array', () => {
    expect(() => parseExplainJson('[]')).toThrow(/non-empty array/);
  });

  it('throws when the Plan node is missing', () => {
    expect(() => parseExplainJson('[{}]')).toThrow(/missing Plan/);
  });
});

describe('flattenNodes', () => {
  it('walks the whole tree depth-first', () => {
    const root = parseExplainJson(fixture('plan-memory-sort.json'));
    const types = flattenNodes(root.Plan).map((n) => n['Node Type']);
    expect(types).toEqual(['Sort', 'Function Scan']);
  });
});

describe('summarizePlan', () => {
  it('reports an in-memory sort as not spilling to disk', () => {
    const summary = summarizePlan(parseExplainJson(fixture('plan-memory-sort.json')));
    expect(summary.usesDiskSort).toBe(false);
    expect(summary.nodeTypes).toContain('Sort');
    expect(summary.maxRowsRemovedByFilter).toBe(42858);
    expect(summary.executionTimeMs).toBeGreaterThan(0);
  });

  it('detects an external-merge sort spilling to disk', () => {
    const summary = summarizePlan(parseExplainJson(fixture('plan-disk-sort.json')));
    expect(summary.usesDiskSort).toBe(true);
  });
});
