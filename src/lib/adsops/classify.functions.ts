import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
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

export const saveClassifyEdits = createServerFn({ method: "POST" })
  .validator(asPayload)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const { assertOps } = await import("./access.server.ts");
    await assertOps(context.userId);
    const { saveClassifyEdits: run } = await import("./classify.server.ts");
    return run(data) as Promise<ClassifySaveResult>;
  });
