/**
 * Minimal typed view over PostgreSQL's `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
 * output. We model only the fields the benchmark reasons about; the planner
 * emits many more and they are ignored harmlessly.
 */
export interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Sort Method'?: string;
  'Sort Space Type'?: string;
  'Rows Removed by Filter'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}

export interface ExplainRoot {
  Plan: PlanNode;
  'Planning Time'?: number;
  'Execution Time'?: number;
}

/** Parse the JSON text returned by `EXPLAIN (... FORMAT JSON)` into its root node. */
export function parseExplainJson(raw: string): ExplainRoot {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Unexpected EXPLAIN JSON: expected a non-empty array');
  }
  const root = parsed[0] as ExplainRoot;
  if (!root.Plan) {
    throw new Error('Unexpected EXPLAIN JSON: missing Plan node');
  }
  return root;
}

/** Depth-first list of every node in the plan tree. */
export function flattenNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenNodes)];
}

export interface PlanSummary {
  executionTimeMs?: number;
  planningTimeMs?: number;
  nodeTypes: string[];
  indexesUsed: string[];
  relationsSeqScanned: string[];
  usesSeqScan: boolean;
  usesDiskSort: boolean;
  maxRowsRemovedByFilter: number;
  sharedBlocksAccessed: number;
}

const unique = (values: string[]): string[] => [...new Set(values)];

/** Distilled, assertable facts about a plan — the basis for verifying an optimization worked. */
export function summarizePlan(root: ExplainRoot): PlanSummary {
  const nodes = flattenNodes(root.Plan);

  return {
    executionTimeMs: root['Execution Time'],
    planningTimeMs: root['Planning Time'],
    nodeTypes: unique(nodes.map((n) => n['Node Type'])),
    indexesUsed: unique(
      nodes.map((n) => n['Index Name']).filter((name): name is string => Boolean(name)),
    ),
    relationsSeqScanned: unique(
      nodes
        .filter((n) => n['Node Type'] === 'Seq Scan')
        .map((n) => n['Relation Name'])
        .filter((name): name is string => Boolean(name)),
    ),
    usesSeqScan: nodes.some((n) => n['Node Type'] === 'Seq Scan'),
    usesDiskSort: nodes.some(
      (n) => n['Sort Space Type'] === 'Disk' || (n['Sort Method'] ?? '').includes('external'),
    ),
    maxRowsRemovedByFilter: Math.max(0, ...nodes.map((n) => n['Rows Removed by Filter'] ?? 0)),
    sharedBlocksAccessed: nodes.reduce(
      (sum, n) => sum + (n['Shared Hit Blocks'] ?? 0) + (n['Shared Read Blocks'] ?? 0),
      0,
    ),
  };
}
