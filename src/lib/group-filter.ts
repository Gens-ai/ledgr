/**
 * The category-group filter shared by Reports and Transactions (fork,
 * 2026-11-14): personal vs business is separated by category group, so a view
 * that needs one side filters by group — "only these groups" or "all except
 * these groups". Uncategorized rows belong to no group: they show only when no
 * group filter is active, or in exclude mode.
 *
 * Pure URL-param helpers. The SQL lives in `queries/group-filter.ts`.
 */

export type GroupMode = "include" | "exclude";

export interface GroupFilter {
  /** Category group ids; absent or empty = no group filter. */
  groupIds?: string[];
  /** Defaults to "include" when groupIds is set. */
  groupMode?: GroupMode;
}

/** `?groups=a,b&groupMode=exclude` → a GroupFilter; `{}` when no groups are named. */
export function parseGroupFilterParams(
  groups: string | null | undefined,
  mode: string | null | undefined,
): GroupFilter {
  const groupIds = [...new Set((groups ?? "").split(",").filter(Boolean))];
  if (groupIds.length === 0) return {};
  return { groupIds, groupMode: mode === "exclude" ? "exclude" : "include" };
}

/** The URL params for a selection; nulls clear them. Include mode is the default, so it is never written. */
export function groupFilterParams(
  groupIds: string[],
  mode: GroupMode,
): { groups: string | null; groupMode: string | null } {
  if (groupIds.length === 0) return { groups: null, groupMode: null };
  return { groups: groupIds.join(","), groupMode: mode === "exclude" ? "exclude" : null };
}

/** "Business", "2 groups", "All except Business" — or null when nothing selected resolves. */
export function describeGroupFilter(
  groupIds: string[],
  mode: GroupMode,
  groups: { id: string; name: string }[],
): string | null {
  const known = groups.filter((g) => groupIds.includes(g.id));
  if (known.length === 0) return null;
  const names = known.length === 1 ? known[0].name : `${known.length} groups`;
  return mode === "exclude" ? `All except ${names}` : names;
}
