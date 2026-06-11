/** Median is the headline metric: robust to the occasional GC/IO outlier that skews a mean. */
export function median(values: number[]): number {
  if (values.length === 0) {
    throw new Error('median of an empty list is undefined');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** How many times faster `before` is than `after` (e.g. 20 => "20x faster"). */
export function speedup(beforeMs: number, afterMs: number): number {
  if (afterMs <= 0) {
    throw new Error('afterMs must be positive');
  }
  return beforeMs / afterMs;
}

/** Percentage reduction from `before` to `after`, clamped at 0 (e.g. 95 => "95% faster"). */
export function percentFaster(beforeMs: number, afterMs: number): number {
  if (beforeMs <= 0) {
    throw new Error('beforeMs must be positive');
  }
  return Math.max(0, (1 - afterMs / beforeMs) * 100);
}
