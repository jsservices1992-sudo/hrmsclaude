/**
 * The organisation as a shape you can reason about, rather than a list of
 * employees with a manager column.
 *
 * The thing that makes this more than a tree render: people leave. A
 * manager on notice still runs their team today, and on their last day
 * that team has to land somewhere. Building the tree from active
 * employees alone silently promotes their reports to the top level, which
 * reads as though they report to nobody rather than as a team that needs
 * a new manager — so leavers stay in the tree, marked, until someone
 * decides where their reports go.
 */

export type OrgStatus = "active" | "resigned" | "exited";

export type OrgPerson = {
  id: string;
  name: string;
  empCode: string;
  designation: string | null;
  department: string | null;
  departmentId: string | null;
  managerId: string | null;
  status: OrgStatus;
  /** Set when the person has an exit case — they are on the way out. */
  lastWorkingDay: string | null;
  /** Named successor, where one has been decided. */
  replacementId: string | null;
  replacementName: string | null;
};

export type OrgNode = OrgPerson & {
  children: OrgNode[];
  /** People reporting directly to this person. */
  directCount: number;
  /** Everyone underneath, at any depth. */
  totalCount: number;
  depth: number;
};

/** A team whose manager is leaving or already gone. */
export type Orphan = {
  manager: OrgPerson;
  reportCount: number;
  /** Null when nobody has been named to take the team on. */
  replacementName: string | null;
};

export type OrgInsights = {
  roots: OrgNode[];
  flat: OrgNode[];
  headcount: number;
  /** Managers who are leaving, and whether their team has somewhere to go. */
  orphans: Orphan[];
  /** Active people with no manager set at all. */
  unassigned: OrgPerson[];
  leavers: OrgPerson[];
  maxDepth: number;
  /** Managers ranked by how many people sit under them. */
  spans: { person: OrgNode; direct: number; total: number }[];
  byDepartment: { id: string | null; name: string; count: number }[];
};

/** Resigned or exited — on the way out, or already gone. */
export const isLeaving = (p: { status: OrgStatus }) => p.status !== "active";

/**
 * Assembles the reporting tree. A manager who is not in the set — because
 * they sit in another company, or their record is gone — leaves their
 * reports at the top rather than dropping them from the chart.
 */
export function buildTree(people: OrgPerson[]): OrgNode[] {
  const nodes = new Map<string, OrgNode>(
    people.map((p) => [p.id, { ...p, children: [], directCount: 0, totalCount: 0, depth: 0 }]),
  );
  const managerOf = new Map(people.map((p) => [p.id, p.managerId]));

  /* Bad data can point managers at each other in a loop. Such a link is
     dropped rather than attached, so the structure stays a real tree —
     otherwise any walk over it recurses until the stack gives out. The
     person still appears, at the top level, where the loop is visible
     and can be corrected. */
  const inCycle = (id: string): boolean => {
    const seen = new Set<string>([id]);
    let cursor = managerOf.get(id) ?? null;
    while (cursor) {
      if (cursor === id) return true;
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      cursor = managerOf.get(cursor) ?? null;
    }
    return false;
  };

  const roots: OrgNode[] = [];
  for (const p of people) {
    const node = nodes.get(p.id)!;
    const parent = p.managerId ? nodes.get(p.managerId) : undefined;
    if (parent && parent.id !== node.id && !inCycle(p.id)) parent.children.push(node);
    else roots.push(node);
  }

  const measure = (node: OrgNode, depth: number): number => {
    node.depth = depth;
    node.children.sort((a, b) => a.empCode.localeCompare(b.empCode));
    node.directCount = node.children.length;
    node.totalCount = node.children.reduce((a, c) => a + measure(c, depth + 1) + 1, 0);
    return node.totalCount;
  };

  roots.sort((a, b) => a.empCode.localeCompare(b.empCode));
  for (const r of roots) measure(r, 0);
  return roots;
}

/** Depth-first walk, parents before children. */
export function flatten(roots: OrgNode[]): OrgNode[] {
  const out: OrgNode[] = [];
  const walk = (n: OrgNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/**
 * Teams about to lose their manager. A leaver with nobody under them is
 * not an orphan — there is no team to rehome.
 */
export function findOrphans(nodes: OrgNode[]): Orphan[] {
  return nodes
    .filter((n) => isLeaving(n) && n.directCount > 0)
    .map((n) => ({
      manager: n,
      reportCount: n.directCount,
      replacementName: n.replacementName,
    }))
    .sort((a, b) => b.reportCount - a.reportCount);
}

/** Everyone under this person, used to refuse a circular reassignment. */
export function descendantIds(node: OrgNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: OrgNode) => {
    for (const c of n.children) {
      out.add(c.id);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** Guard against a reassignment that would detach a branch from the tree. */
export function wouldCycle(people: OrgPerson[], employeeId: string, newManagerId: string): boolean {
  if (employeeId === newManagerId) return true;
  const managerOf = new Map(people.map((p) => [p.id, p.managerId]));
  let cursor: string | null | undefined = newManagerId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === employeeId) return true;
    if (seen.has(cursor)) return false; // pre-existing cycle, not one we add
    seen.add(cursor);
    cursor = managerOf.get(cursor) ?? null;
  }
  return false;
}
