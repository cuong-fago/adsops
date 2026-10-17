/** Who may build / manage client reports: Admin, Trưởng phòng Ads, Optimizer (account grants = assignment). */
type Ctx = { principal: { kind: string; role: string } };
export function isReportStaff(ctx: Ctx): boolean {
  return ctx.principal.kind === "staff" && (ctx.principal.role === "admin" || ctx.principal.role === "head_ads" || ctx.principal.role === "optimizer");
}
