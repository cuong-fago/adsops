import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { ClassifyEdit, ClassifySaveResult } from "./classify.types.ts";

export type { ClassifyEdit, ClassifySaveResult, ClassifySnap, ClassifyCluster, ClassifyLabel } from "./classify.types.ts";

function asPayload(data: unknown): { clientId: string; edits: ClassifyEdit[] } {
  if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
  const d = data as Record<string, unknown>;
  const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
  if (!clientId) throw new Error("Thiếu khách");
  const edits = Array.isArray(d.edits) ? (d.edits as ClassifyEdit[]) : [];
  return { clientId, edits };
}

/** Editing ST labels: admin, head_ads, optimizer, on granted accounts. */
export const saveClassifyEdits = createServerFn({ method: "POST" })
  .validator(asPayload)
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertCap, assertWritable, assertAccount } = await import("./permissions.server");
    const ctx = context.access;
    assertCap(ctx, "opsTabs");
    assertCap(ctx, "pull", "Sale chỉ xem Phân loại ST, không sửa.");
    assertWritable(ctx);
    assertAccount(ctx, data.clientId);
    const { saveClassifyEdits: run } = await import("./classify.server.ts");
    return run(data) as Promise<ClassifySaveResult>;
  });
