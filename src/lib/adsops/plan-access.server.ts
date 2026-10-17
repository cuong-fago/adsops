/** Who may edit AdsOps-owned planning data (budget plan, business outcomes). Server only. */
import { canSeeAccount, type AccessContext } from "./permissions.server";

/** Admin, Trưởng phòng Ads, or an Optimizer granted the account (grant = assignment). Never while viewing-as. */
export function planEditor(ctx: AccessContext): (id: string) => boolean {
  const role = ctx.principal.role;
  return (id: string) => !ctx.readOnly && canSeeAccount(ctx, id) && (role === "admin" || role === "head_ads" || role === "optimizer");
}
