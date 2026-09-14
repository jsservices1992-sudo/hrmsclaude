/**
 * Asset issue/revoke rules — kept pure so the transitions are tested
 * independently of the database. Company property moving to and from
 * an employee is exactly the kind of thing that goes wrong silently: an
 * asset issued twice, or one that never comes back "in stock" after a
 * good-condition return.
 */

export type AssetStatus = "in_stock" | "issued" | "under_repair" | "retired" | "lost";
export type ReturnCondition = "good" | "damaged" | "lost";

export type IssueCheck = { ok: true } | { ok: false; error: string };

/**
 * An asset may be issued only from in_stock. "issued" catches the
 * double-issue a stale page reload could otherwise cause; the other
 * statuses are terminal or need attention before they can move again.
 */
export function checkCanIssue(asset: { status: AssetStatus }): IssueCheck {
  if (asset.status === "issued") {
    return { ok: false, error: "This asset is already issued to someone. Revoke it first." };
  }
  if (asset.status === "in_stock") return { ok: true };
  return {
    ok: false,
    error: `This asset is ${asset.status.replace("_", " ")} and cannot be issued until that is resolved.`,
  };
}

/**
 * What a returned asset's status becomes. A "lost" return does not
 * silently vanish back into available stock, and "damaged" needs a
 * repair step before it can be issued to the next person.
 */
export function statusAfterReturn(condition: ReturnCondition): AssetStatus {
  switch (condition) {
    case "good":
      return "in_stock";
    case "damaged":
      return "under_repair";
    case "lost":
      return "lost";
  }
}
