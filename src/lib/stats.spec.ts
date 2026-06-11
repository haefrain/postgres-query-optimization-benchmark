import { describe, expect, it } from 'vitest';

import { median, percentFaster, speedup } from './stats';

describe('median', () => {
  it('returns the middle value for an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles a single value', () => {
    expect(median([42])).toBe(42);
  });

  it('does not mutate the input', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it('throws on an empty list', () => {
    expect(() => median([])).toThrow(/empty/);
  });
});

describe('speedup', () => {
  it('computes how many times faster', () => {
    expect(speedup(1000, 50)).toBe(20);
  });

  it('throws when after is non-positive', () => {
    expect(() => speedup(1000, 0)).toThrow();
  });
});

describe('percentFaster', () => {
  it('computes percentage reduction', () => {
    expect(percentFaster(1000, 50)).toBe(95);
  });

  it('clamps at 0 when the optimized query is slower', () => {
    expect(percentFaster(50, 1000)).toBe(0);
  });
});
