import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import type { PushPrefs, PushState } from "./push.types.ts";

const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

export const getPushStateFn = createServerFn({ method: "GET" })
  .middleware([principalMiddleware])
  .handler(async ({ context }): Promise<PushState> => {
    const { allowedPushKinds } = await import("./push.types.ts");
    const { getPrefs, vapid } = await import("./push.server.ts");
    const p = context.access.principal;
    const v = vapid();
    const { prefs, devices } = await getPrefs(p);
    return { configured: !!v, public_key: v?.pub ?? null, allowed: allowedPushKinds(p.kind, p.role), prefs, devices };
  });

export const subscribePushFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const o = (d || {}) as Record<string, unknown>;
    const endpoint = str(o.endpoint, 2000), p256dh = str(o.p256dh, 200), auth = str(o.auth, 100);
    if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new Error("Đăng ký thông báo không hợp lệ.");
    return { endpoint, p256dh, auth };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertWritable } = await import("./permissions.server");
    assertWritable(context.access);
    const { getRequest } = await import("@tanstack/react-start/server");
    const { saveSubscription } = await import("./push.server.ts");
    await saveSubscription(context.access.principal, data, getRequest()?.headers.get("user-agent") ?? null);
    return { ok: true };
  });

export const unsubscribePushFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const e = str((d as Record<string, unknown>)?.endpoint, 2000);
    if (!e) throw new Error("Thiếu endpoint.");
    return { endpoint: e };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertWritable } = await import("./permissions.server");
    assertWritable(context.access);
    const { removeSubscription } = await import("./push.server.ts");
    await removeSubscription(context.access.principal, data.endpoint);
    return { ok: true };
  });

export const setPushPrefsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const o = (d || {}) as Record<string, unknown>;
    const out: Partial<PushPrefs> = {};
    for (const k of ["budget", "conv_drop", "invoices"] as const) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
    return out;
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertWritable } = await import("./permissions.server");
    assertWritable(context.access);
    const { allowedPushKinds } = await import("./push.types.ts");
    const { setPrefs } = await import("./push.server.ts");
    const p = context.access.principal;
    return setPrefs(p, allowedPushKinds(p.kind, p.role), data);
  });

export const testPushFn = createServerFn({ method: "POST" })
  .middleware([principalMiddleware])
  .handler(async ({ context }) => {
    const { assertWritable } = await import("./permissions.server");
    assertWritable(context.access);
    const { sendTest } = await import("./push.server.ts");
    return { sent: await sendTest(context.access.principal) };
  });
