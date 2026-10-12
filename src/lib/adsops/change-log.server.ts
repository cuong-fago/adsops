/**
 * Keyword optimization change log ("Nhật ký tối ưu").
 *
 * Pull: READ-ONLY GAQL (SELECT on change_event, change_status, and criterion
 * lookups) through `searchLeaf`, so each account is read with its own
 * login-customer-id. Never mutates Google Ads.
 * Google serves change_event for the last 30 days only; every pull is upserted
 * into Neon (`ads_change_events`) so the history keeps growing, and each pull
 * attempt is recorded in `ads_change_pulls` so "chưa kéo" is never shown as 0.
 */
import { getSql } from "@/lib/db";
import { AdsApiError, resolveAdsConfig, type AdsConfig, type GaqlRow } from "./google-ads.server.ts";
import { acquireLock, asRec, customerIdFor, pullMeta, releaseLock, searchLeaf, ymdInTz, addDaysYmd } from "./warehouse.server.ts";
import {
  actionsInBucket,
  isOptimization,
  summaryBucketOf,
  type ChangeDrill,
  type AccountCoverage,
  type ChangeAccountSummary,
  type ChangeAction,
  type ChangeKind,
  type ChangeLevel,
  type ChangeLogPullResult,
  type ChangeLogRead,
  type ChangeRow,
} from "./change-log.types.ts";

const CLIENT_ID_RE = /^[a-z0-9_]+$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Google: change_event must be filtered to the last 30 days; LIMIT at most 10000. */
const WINDOW_DAYS = 29;
const PAGE_LIMIT = 10000;
const MAX_PAGES = 3;
const READ_ROW_CAP = 3000;
const CRITERION_RE = /^customers\/\d{10}\/(adGroupCriteria|campaignCriteria)\/\d+~\d+$/;
const CSS_RE = /^customers\/\d{10}\/campaignSharedSets\/\d+~\d+$/;

/** Exact GAQL used for keyword-level changes (dates in the account time zone). */
export function changeEventQuery(start: string, end: string, withNames = true): string {
  return `SELECT change_event.resource_name, change_event.change_date_time, change_event.change_resource_type,
    change_event.resource_change_operation, change_event.changed_fields, change_event.user_email,
    change_event.client_type, change_event.campaign, change_event.ad_group, change_event.change_resource_name,
    change_event.old_resource, change_event.new_resource${withNames ? ", campaign.name, ad_group.name" : ""}
  FROM change_event
  WHERE change_event.change_date_time >= '${start}' AND change_event.change_date_time <= '${end}'
    AND change_event.change_resource_type IN ('AD_GROUP_CRITERION', 'CAMPAIGN_CRITERION')
  ORDER BY change_event.change_date_time DESC
  LIMIT ${PAGE_LIMIT}`;
}

/** Shared negative lists: change_event has no SHARED_SET type, so change_status is used (no user / no keyword text). */
// Only change_status fields (as in Google's examples); list / campaign names are read
// in separate queries. Upper bound is today 23:59:59 (never a future date).
export function sharedSetStatusQuery(start: string, today: string): string {
  return `SELECT change_status.resource_name, change_status.last_change_date_time, change_status.resource_type,
    change_status.resource_status, change_status.shared_set, change_status.campaign_shared_set, change_status.campaign
  FROM change_status
  WHERE change_status.last_change_date_time >= '${start} 00:00:00'
    AND change_status.last_change_date_time <= '${today} 23:59:59'
    AND change_status.resource_type IN ('SHARED_SET', 'CAMPAIGN_SHARED_SET')
  ORDER BY change_status.last_change_date_time DESC
  LIMIT ${PAGE_LIMIT}`;
}

// ── time helpers ────────────────────────────────────────────────────────────────

function tzOffsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** "2026-10-09 14:23:11.123456" in `tz` → "2026-10-09T14:23:11.123456+07:00" (keeps microseconds). */
export function localToOffsetIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?/.exec(local.trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  let off = tzOffsetMinutes(guess, tz);
  const off2 = tzOffsetMinutes(guess - off * 60000, tz);
  if (off2 !== off) off = off2;
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ""}${sign}${hh}:${mm}`;
}

function saigonStart(ymd: string): string {
  return `${ymd}T00:00:00+07:00`;
}

// ── parsing ─────────────────────────────────────────────────────────────────────

type Criterion = {
  type?: string;
  text?: string;
  matchType?: string;
  negative?: boolean;
  status?: string;
  bidMicros?: number | null;
};

function readCriterion(res: unknown): Criterion {
  const r = asRec(res);
  const c = asRec(r.adGroupCriterion ?? r.campaignCriterion);
  const kw = asRec(c.keyword);
  const bid = c.cpcBidMicros;
  return {
    type: c.type ? String(c.type) : undefined,
    text: kw.text ? String(kw.text) : undefined,
    matchType: kw.matchType ? String(kw.matchType) : undefined,
    negative: typeof c.negative === "boolean" ? c.negative : undefined,
    status: c.status ? String(c.status) : undefined,
    bidMicros: bid != null && bid !== "" && Number.isFinite(Number(bid)) ? Number(bid) : null,
  };
}

function changedPaths(raw: unknown): string[] {
  if (typeof raw === "string") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  const paths = asRec(raw).paths;
  return Array.isArray(paths) ? paths.map(String) : [];
}

function idFrom(resourceName: unknown, kind: "campaigns" | "adGroups"): string | null {
  const m = new RegExp(`/${kind}/(\\d+)`).exec(String(resourceName || ""));
  return m ? m[1] : null;
}

function campaignIdFromCriterion(name: string): string | null {
  const m = /\/campaignCriteria\/(\d+)~/.exec(name);
  return m ? m[1] : null;
}

function adGroupIdFromCriterion(name: string): string | null {
  const m = /\/adGroupCriteria\/(\d+)~/.exec(name);
  return m ? m[1] : null;
}

type EventRow = {
  change_date_time: string;
  source: "change_event" | "change_status";
  resource_type: string;
  operation: string;
  action: ChangeAction;
  criterion_kind: ChangeKind;
  level: ChangeLevel;
  change_resource_name: string;
  keyword_text: string | null;
  match_type: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_group_id: string | null;
  ad_group_name: string | null;
  shared_set_name: string | null;
  user_email: string | null;
  client_type: string | null;
  changed_fields: string | null;
  old_status: string | null;
  new_status: string | null;
  old_bid_micros: number | null;
  new_bid_micros: number | null;
  raw: unknown;
};

type Pending = {
  local: string;
  resourceType: string;
  operation: string;
  resourceName: string;
  paths: string[];
  oldC: Criterion;
  newC: Criterion;
  campaignId: string | null;
  campaignName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  userEmail: string | null;
  clientType: string | null;
  raw: unknown;
};

function toPending(row: GaqlRow): Pending | null {
  const ce = asRec(row.changeEvent);
  const resourceName = String(ce.changeResourceName || "");
  const local = String(ce.changeDateTime || "");
  if (!resourceName || !local) return null;
  const resourceType = String(ce.changeResourceType || "");
  const campaignId = idFrom(ce.campaign, "campaigns") || (resourceType === "CAMPAIGN_CRITERION" ? campaignIdFromCriterion(resourceName) : null);
  const adGroupId = idFrom(ce.adGroup, "adGroups") || adGroupIdFromCriterion(resourceName);
  return {
    local,
    resourceType,
    operation: String(ce.resourceChangeOperation || ""),
    resourceName,
    paths: changedPaths(ce.changedFields),
    oldC: readCriterion(ce.oldResource),
    newC: readCriterion(ce.newResource),
    campaignId,
    campaignName: asRec(row.campaign).name ? String(asRec(row.campaign).name) : null,
    adGroupId: resourceType === "AD_GROUP_CRITERION" ? adGroupId : null,
    adGroupName: resourceType === "AD_GROUP_CRITERION" && asRec(row.adGroup).name ? String(asRec(row.adGroup).name) : null,
    userEmail: ce.userEmail ? String(ce.userEmail) : null,
    clientType: ce.clientType ? String(ce.clientType) : null,
    raw: ce,
  };
}

function classify(p: Pending, extra: Criterion | undefined): EventRow | "skip" {
  const type = p.newC.type || p.oldC.type || extra?.type || (p.newC.text || p.oldC.text || extra?.text ? "KEYWORD" : "");
  if (type && type !== "KEYWORD") return "skip"; // locations, audiences, devices… are not keyword work
  const level: ChangeLevel = p.resourceType === "CAMPAIGN_CRITERION" ? "campaign" : "ad_group";
  const negative = p.newC.negative ?? p.oldC.negative ?? extra?.negative ?? level === "campaign";
  const kind: ChangeKind = !type ? "other" : negative ? "negative" : "keyword";
  // REST returns lowerCamelCase paths ("cpcBidMicros"); compare without case / underscores.
  const paths = p.paths.map((s) => s.toLowerCase().replace(/_/g, ""));
  const has = (k: string) => paths.some((x) => x === k || x.endsWith(`.${k}`));
  let action: ChangeAction = "other";
  if (kind !== "other") {
    if (p.operation === "CREATE") action = negative ? "add_negative" : "add_keyword";
    else if (p.operation === "REMOVE") action = negative ? "remove_negative" : "remove_keyword";
    else if (p.operation === "UPDATE") {
      const ns = p.newC.status || "";
      if (has("status") && ns === "PAUSED") action = "pause";
      else if (has("status") && ns === "ENABLED") action = "enable";
      else if (has("status") && ns === "REMOVED") action = negative ? "remove_negative" : "remove_keyword";
      else if (has("cpcbidmicros")) action = "bid_change";
      else action = "other_update";
    }
  }
  return {
    change_date_time: p.local,
    source: "change_event",
    resource_type: p.resourceType,
    operation: p.operation,
    action,
    criterion_kind: kind,
    level,
    change_resource_name: p.resourceName,
    keyword_text: p.newC.text || p.oldC.text || extra?.text || null,
    match_type: p.newC.matchType || p.oldC.matchType || extra?.matchType || null,
    campaign_id: p.campaignId,
    campaign_name: p.campaignName,
    ad_group_id: p.adGroupId,
    ad_group_name: p.adGroupName,
    shared_set_name: null,
    user_email: p.userEmail,
    client_type: p.clientType,
    changed_fields: p.paths.join(",") || null,
    old_status: p.operation === "CREATE" ? null : p.oldC.status || null,
    new_status: p.operation === "REMOVE" ? "REMOVED" : p.newC.status || null,
    old_bid_micros: p.operation === "CREATE" ? null : p.oldC.bidMicros ?? null,
    new_bid_micros: p.operation === "REMOVE" ? null : p.newC.bidMicros ?? null,
    raw: p.raw,
  };
}

function sqlList(names: string[]): string {
  return names.map((n) => `'${n}'`).join(", ");
}

/** Keyword text / type for UPDATE and REMOVE events (Google only returns changed fields). */
async function enrichCriteria(cfg: AdsConfig, customerId: string, names: string[]): Promise<Map<string, Criterion>> {
  const out = new Map<string, Criterion>();
  if (!names.length) return out;
  // 1) What AdsOps already stored for these criteria.
  try {
    const sql = await getSql();
    const rows = await sql.query<{ change_resource_name: string; keyword_text: string | null; match_type: string | null; criterion_kind: string }>(
      `select distinct on (change_resource_name) change_resource_name, keyword_text, match_type, criterion_kind
       from ads_change_events
       where external_id = $1 and change_resource_name = any($2::text[]) and keyword_text is not null
       order by change_resource_name, change_date_time desc`,
      [customerId, names],
    );
    for (const r of rows) {
      out.set(r.change_resource_name, {
        type: "KEYWORD",
        text: r.keyword_text || undefined,
        matchType: r.match_type || undefined,
        negative: r.criterion_kind === "negative",
      });
    }
  } catch {
    /* table may be new */
  }
  // 2) Read-only lookups for the rest.
  const missing = names.filter((n) => !out.has(n) && CRITERION_RE.test(n));
  const ag = missing.filter((n) => n.includes("/adGroupCriteria/"));
  const camp = missing.filter((n) => n.includes("/campaignCriteria/"));
  for (let i = 0; i < ag.length; i += 100) {
    const chunk = ag.slice(i, i + 100);
    const rows = await searchLeaf(
      cfg,
      customerId,
      `SELECT ad_group_criterion.resource_name, ad_group_criterion.type, ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type, ad_group_criterion.negative, ad_group_criterion.status
       FROM ad_group_criterion WHERE ad_group_criterion.resource_name IN (${sqlList(chunk)})`,
    ).catch(() => [] as GaqlRow[]);
    for (const r of rows) {
      const c = asRec(r.adGroupCriterion);
      if (c.resourceName) out.set(String(c.resourceName), readCriterion({ adGroupCriterion: c }));
    }
  }
  for (let i = 0; i < camp.length; i += 100) {
    const chunk = camp.slice(i, i + 100);
    const rows = await searchLeaf(
      cfg,
      customerId,
      `SELECT campaign_criterion.resource_name, campaign_criterion.type, campaign_criterion.keyword.text,
        campaign_criterion.keyword.match_type, campaign_criterion.negative, campaign_criterion.status
       FROM campaign_criterion WHERE campaign_criterion.resource_name IN (${sqlList(chunk)})`,
    ).catch(() => [] as GaqlRow[]);
    for (const r of rows) {
      const c = asRec(r.campaignCriterion);
      if (c.resourceName) out.set(String(c.resourceName), readCriterion({ campaignCriterion: c }));
    }
  }
  return out;
}

/** Campaign / ad group names missing from the joined query. */
async function fillNames(cfg: AdsConfig, customerId: string, rows: EventRow[]): Promise<void> {
  const campIds = [...new Set(rows.filter((r) => r.campaign_id && !r.campaign_name).map((r) => r.campaign_id as string))].filter((id) => /^\d+$/.test(id));
  const agIds = [...new Set(rows.filter((r) => r.ad_group_id && !r.ad_group_name).map((r) => r.ad_group_id as string))].filter((id) => /^\d+$/.test(id));
  const campNames = new Map<string, string>();
  const agNames = new Map<string, { name: string; campaign_id: string | null; campaign_name: string | null }>();
  for (let i = 0; i < campIds.length; i += 200) {
    const chunk = campIds.slice(i, i + 200);
    const res = await searchLeaf(cfg, customerId, `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.id IN (${chunk.join(", ")})`).catch(() => [] as GaqlRow[]);
    for (const r of res) {
      const c = asRec(r.campaign);
      if (c.id) campNames.set(String(c.id), String(c.name || ""));
    }
  }
  for (let i = 0; i < agIds.length; i += 200) {
    const chunk = agIds.slice(i, i + 200);
    const res = await searchLeaf(
      cfg,
      customerId,
      `SELECT ad_group.id, ad_group.name, campaign.id, campaign.name FROM ad_group WHERE ad_group.id IN (${chunk.join(", ")})`,
    ).catch(() => [] as GaqlRow[]);
    for (const r of res) {
      const g = asRec(r.adGroup);
      const c = asRec(r.campaign);
      if (g.id) agNames.set(String(g.id), { name: String(g.name || ""), campaign_id: c.id ? String(c.id) : null, campaign_name: c.name ? String(c.name) : null });
    }
  }
  for (const r of rows) {
    if (r.ad_group_id && !r.ad_group_name) {
      const g = agNames.get(r.ad_group_id);
      if (g) {
        r.ad_group_name = g.name || null;
        if (!r.campaign_id) r.campaign_id = g.campaign_id;
        if (!r.campaign_name) r.campaign_name = g.campaign_name;
      }
    }
    if (r.campaign_id && !r.campaign_name) r.campaign_name = campNames.get(r.campaign_id) || null;
  }
}

const SHARED_SET_RE = /^customers\/\d{10}\/sharedSets\/\d+$/;

async function pullSharedLists(cfg: AdsConfig, customerId: string, start: string, today: string): Promise<EventRow[]> {
  const rows = await searchLeaf(cfg, customerId, sharedSetStatusQuery(start, today));
  const out: EventRow[] = [];
  const setNames = new Set<string>();
  const cssNames = new Set<string>();
  for (const r of rows) {
    const cs = asRec(r.changeStatus);
    const type = String(cs.resourceType || "");
    const status = String(cs.resourceStatus || "");
    const local = String(cs.lastChangeDateTime || "");
    const name = type === "SHARED_SET" ? String(cs.sharedSet || "") : String(cs.campaignSharedSet || "");
    if (!name || !local || (type !== "SHARED_SET" && type !== "CAMPAIGN_SHARED_SET")) continue;
    if (type === "SHARED_SET" && SHARED_SET_RE.test(name)) setNames.add(name);
    if (type === "CAMPAIGN_SHARED_SET" && CSS_RE.test(name)) cssNames.add(name);
    const action: ChangeAction =
      type === "SHARED_SET"
        ? status === "ADDED"
          ? "shared_list_created"
          : status === "REMOVED"
            ? "shared_list_removed"
            : "shared_list_changed"
        : status === "ADDED"
          ? "shared_list_attached"
          : status === "REMOVED"
            ? "shared_list_detached"
            : "shared_list_changed";
    out.push({
      change_date_time: local,
      source: "change_status",
      resource_type: type,
      operation: status,
      action,
      criterion_kind: "shared_negative",
      level: "shared",
      change_resource_name: name,
      keyword_text: null,
      match_type: null,
      campaign_id: idFrom(cs.campaign, "campaigns"),
      campaign_name: null,
      ad_group_id: null,
      ad_group_name: null,
      shared_set_name: null,
      user_email: null,
      client_type: null,
      changed_fields: null,
      old_status: null,
      new_status: null,
      old_bid_micros: null,
      new_bid_micros: null,
      raw: cs,
    });
  }
  // Names / types in separate read-only queries (non-fatal). Removed lists may not resolve.
  const setInfo = new Map<string, { name: string; type: string }>();
  const sets = [...setNames];
  for (let i = 0; i < sets.length; i += 100) {
    const res = await searchLeaf(
      cfg,
      customerId,
      `SELECT shared_set.resource_name, shared_set.name, shared_set.type FROM shared_set WHERE shared_set.resource_name IN (${sqlList(sets.slice(i, i + 100))})`,
    ).catch(() => [] as GaqlRow[]);
    for (const r of res) {
      const ss = asRec(r.sharedSet);
      if (ss.resourceName) setInfo.set(String(ss.resourceName), { name: String(ss.name || ""), type: String(ss.type || "") });
    }
  }
  const cssInfo = new Map<string, { name: string; type: string; campaignId: string | null; campaignName: string | null }>();
  const links = [...cssNames];
  for (let i = 0; i < links.length; i += 100) {
    const res = await searchLeaf(
      cfg,
      customerId,
      `SELECT campaign_shared_set.resource_name, shared_set.name, shared_set.type, campaign.id, campaign.name
       FROM campaign_shared_set WHERE campaign_shared_set.resource_name IN (${sqlList(links.slice(i, i + 100))})`,
    ).catch(() => [] as GaqlRow[]);
    for (const r of res) {
      const ss = asRec(r.sharedSet);
      const c = asRec(r.campaign);
      cssInfo.set(String(asRec(r.campaignSharedSet).resourceName || ""), {
        name: String(ss.name || ""),
        type: String(ss.type || ""),
        campaignId: c.id ? String(c.id) : null,
        campaignName: c.name ? String(c.name) : null,
      });
    }
  }
  for (const ev of out) {
    const link = ev.resource_type === "CAMPAIGN_SHARED_SET" ? cssInfo.get(ev.change_resource_name) : undefined;
    const info = link || setInfo.get(ev.change_resource_name);
    if (!info) continue;
    if (info.type && info.type !== "NEGATIVE_KEYWORDS") ev.criterion_kind = "other";
    ev.shared_set_name = info.name || null;
    if (link) {
      ev.campaign_id = ev.campaign_id || link.campaignId;
      ev.campaign_name = link.campaignName;
    }
  }
  await fillNames(cfg, customerId, out);
  const keep = out.filter((e) => e.criterion_kind === "shared_negative");
  await diffNegativeLists(cfg, customerId, keep, setInfo);
  return keep;
}

/**
 * A changed NEGATIVE_KEYWORDS list: read its keywords (read-only shared_criterion), diff against
 * the stored snapshot, and record the added negatives on the list's latest change event.
 * Google gives no user and no per-keyword history here, so all additions since the previous
 * pull are attached to the list's latest change time.
 */
async function diffNegativeLists(
  cfg: AdsConfig,
  customerId: string,
  events: EventRow[],
  setInfo: Map<string, { name: string; type: string }>,
): Promise<void> {
  const changed = events.filter((e) => e.resource_type === "SHARED_SET" && e.operation !== "REMOVED");
  const sets = [...new Set(changed.map((e) => e.change_resource_name))].filter((s) => {
    const type = setInfo.get(s)?.type;
    return !type || type === "NEGATIVE_KEYWORDS";
  });
  if (!sets.length) return;
  // Newest change per list gets the diff.
  const latestBySet = new Map<string, EventRow>();
  for (const e of changed) {
    const cur = latestBySet.get(e.change_resource_name);
    if (!cur || e.change_date_time > cur.change_date_time) latestBySet.set(e.change_resource_name, e);
  }
  const now = new Map<string, Map<string, { text: string; match: string | null }>>();
  for (const s of sets) now.set(s, new Map());
  const campaigns = new Map<string, Set<string>>();
  for (let i = 0; i < sets.length; i += 50) {
    const chunk = sqlList(sets.slice(i, i + 50));
    const rows = await searchLeaf(
      cfg,
      customerId,
      `SELECT shared_criterion.resource_name, shared_criterion.keyword.text, shared_criterion.keyword.match_type, shared_set.resource_name
       FROM shared_criterion WHERE shared_set.resource_name IN (${chunk})`,
    ).catch(() => null);
    if (!rows) {
      for (const s of sets.slice(i, i + 50)) now.delete(s); // unreadable: no diff, no snapshot change
      continue;
    }
    for (const r of rows) {
      const sc = asRec(r.sharedCriterion);
      const kw = asRec(sc.keyword);
      const set = String(asRec(r.sharedSet).resourceName || "");
      if (!sc.resourceName || !kw.text || !now.has(set)) continue;
      now.get(set)!.set(String(sc.resourceName), { text: String(kw.text), match: kw.matchType ? String(kw.matchType) : null });
    }
    const links = await searchLeaf(
      cfg,
      customerId,
      `SELECT campaign.name, shared_set.resource_name FROM campaign_shared_set
       WHERE shared_set.resource_name IN (${chunk}) AND campaign_shared_set.status = 'ENABLED'`,
    ).catch(() => [] as GaqlRow[]);
    for (const r of links) {
      const set = String(asRec(r.sharedSet).resourceName || "");
      const name = String(asRec(r.campaign).name || "");
      if (!set || !name) continue;
      if (!campaigns.has(set)) campaigns.set(set, new Set());
      campaigns.get(set)!.add(name);
    }
  }
  const sql = await getSql();
  for (const [set, current] of now) {
    let had = false;
    const stored = new Set<string>();
    try {
      const b = await sql.query<{ n: number }>(
        `select count(*)::int as n from ads_shared_negative_baseline where external_id = $1 and shared_set = $2`,
        [customerId, set],
      );
      had = (b[0]?.n || 0) > 0;
      const s = await sql.query<{ criterion: string }>(
        `select criterion from ads_shared_negative_snapshot where external_id = $1 and shared_set = $2`,
        [customerId, set],
      );
      for (const r of s) stored.add(r.criterion);
    } catch {
      return; // migration 0013 not applied yet: keep the plain change_status rows
    }
    const added = [...current.entries()].filter(([c]) => !stored.has(c));
    const removed = [...stored].filter((c) => !current.has(c));
    const ev = latestBySet.get(set);
    if (ev) {
      const names = campaigns.get(set);
      if (names?.size && !ev.campaign_name) ev.campaign_name = [...names].sort((a, b) => a.localeCompare(b, "vi")).join(", ");
      if (!had) {
        // First snapshot: Google does not say what changed; record it as an addition without keywords.
        ev.action = "shared_negative_added";
        ev.changed_fields = "Lần đầu chụp danh sách — chưa biết từ khoá nào được thêm";
      } else if (added.length) {
        ev.action = "shared_negative_added";
        const texts = added.map(([, v]) => v.text);
        ev.keyword_text = (texts.slice(0, 20).join(", ") + (texts.length > 20 ? ` … (+${texts.length - 20})` : "")).slice(0, 1000);
        const matches = new Set(added.map(([, v]) => v.match || ""));
        ev.match_type = matches.size === 1 ? [...matches][0] || null : null;
        ev.changed_fields = `+${added.length}${removed.length ? ` / −${removed.length}` : ""} từ khoá phủ định`;
      } else if (removed.length) {
        ev.changed_fields = `−${removed.length} từ khoá phủ định`;
      }
      // No difference (list re-pulled): leave the stored row as it is (upsert keeps its action).
    }
    for (let i = 0; i < added.length; i += 200) {
      const part = added.slice(i, i + 200);
      const params: unknown[] = [];
      const tuples = part.map(([c, v], j) => {
        params.push(customerId, set, c, v.text, v.match);
        const b = j * 5;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
      });
      await sql.query(
        `insert into ads_shared_negative_snapshot (external_id, shared_set, criterion, keyword_text, match_type) values ${tuples.join(", ")}
         on conflict (external_id, criterion) do nothing`,
        params,
      );
    }
    if (removed.length) {
      await sql.query(`delete from ads_shared_negative_snapshot where external_id = $1 and criterion = any($2::text[])`, [customerId, removed]);
    }
    await sql.query(
      `insert into ads_shared_negative_baseline (external_id, shared_set) values ($1, $2)
       on conflict (external_id, shared_set) do update set taken_at = now()`,
      [customerId, set],
    );
  }
}

async function upsertEvents(clientId: string, customerId: string, tz: string, rows: EventRow[]): Promise<number> {
  if (!rows.length) return 0;
  const sql = await getSql();
  const cols = [
    "client_id", "external_id", "change_date_time", "source", "resource_type", "operation", "action", "criterion_kind", "level",
    "change_resource_name", "keyword_text", "match_type", "campaign_id", "campaign_name", "ad_group_id", "ad_group_name",
    "shared_set_name", "user_email", "client_type", "changed_fields", "old_status", "new_status", "old_bid_micros", "new_bid_micros", "raw",
  ];
  let written = 0;
  for (let i = 0; i < rows.length; i += 150) {
    const chunk = rows.slice(i, i + 150);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const r of chunk) {
      const at = localToOffsetIso(r.change_date_time, tz);
      if (!at) continue;
      const vals = [
        clientId, customerId, at, r.source, r.resource_type, r.operation, r.action, r.criterion_kind, r.level,
        r.change_resource_name, r.keyword_text, r.match_type, r.campaign_id, r.campaign_name, r.ad_group_id, r.ad_group_name,
        r.shared_set_name, r.user_email, r.client_type, r.changed_fields, r.old_status, r.new_status, r.old_bid_micros, r.new_bid_micros,
        JSON.stringify(r.raw ?? null),
      ];
      const base = params.length;
      params.push(...vals);
      tuples.push(
        `(${vals.map((_, j) => `$${base + j + 1}${j === 2 ? "::timestamptz" : j === 22 || j === 23 ? "::bigint" : j === 24 ? "::jsonb" : ""}`).join(", ")})`,
      );
    }
    if (!tuples.length) continue;
    await sql.query(
      `insert into ads_change_events (${cols.join(", ")}) values ${tuples.join(", ")}
       on conflict on constraint ads_change_events_dedupe do update set
         client_id = excluded.client_id,
         -- change_status rows: the snapshot diff only knows the added keywords on the first pull
         -- that sees the change, so a later re-pull of the same event never downgrades it.
         action = case when ads_change_events.source = 'change_status' and ads_change_events.action = 'shared_negative_added'
                       then ads_change_events.action else excluded.action end,
         changed_fields = coalesce(ads_change_events.changed_fields, excluded.changed_fields),
         criterion_kind = excluded.criterion_kind,
         keyword_text = coalesce(excluded.keyword_text, ads_change_events.keyword_text),
         match_type = coalesce(excluded.match_type, ads_change_events.match_type),
         campaign_id = coalesce(excluded.campaign_id, ads_change_events.campaign_id),
         campaign_name = coalesce(excluded.campaign_name, ads_change_events.campaign_name),
         ad_group_id = coalesce(excluded.ad_group_id, ads_change_events.ad_group_id),
         ad_group_name = coalesce(excluded.ad_group_name, ads_change_events.ad_group_name),
         shared_set_name = coalesce(excluded.shared_set_name, ads_change_events.shared_set_name),
         user_email = coalesce(excluded.user_email, ads_change_events.user_email),
         pulled_at = now()`,
      params,
    );
    written += tuples.length;
  }
  return written;
}

async function recordPull(row: {
  clientId: string;
  customerId: string;
  coveredStart: string | null;
  ok: boolean;
  rowCount: number;
  truncated: boolean;
  trigger: string;
  actor: string | null;
  error: string | null;
  note: string | null;
}): Promise<string | null> {
  const sql = await getSql();
  const res = await sql.query<{ covered_end: string | null }>(
    `insert into ads_change_pulls (client_id, external_id, covered_start, covered_end, ok, row_count, truncated, trigger, actor, error_vi, note_vi)
     values ($1, $2, $3::timestamptz, case when $4::boolean then now() else null end, $4::boolean, $5::int, $6::boolean, $7, $8, $9, $10)
     returning covered_end`,
    [row.clientId, row.customerId, row.coveredStart, row.ok, row.rowCount, row.truncated, row.trigger, row.actor, row.error, row.note],
  );
  const end = res[0]?.covered_end as unknown;
  return end instanceof Date ? end.toISOString() : end ? String(end) : null;
}

function errorVi(err: unknown): string {
  if (err instanceof AdsApiError) return err.adminMessage;
  return err instanceof Error && err.message ? err.message : "Không kéo được nhật ký.";
}

/** Pull the last 30 days of keyword changes for one account and upsert them. */
export async function pullChangeLog(
  clientId: string,
  opts: { trigger: "manual" | "cron" | "auto"; actor: string | null; cfg?: AdsConfig },
): Promise<ChangeLogPullResult> {
  const id = clientId.trim();
  const base: ChangeLogPullResult = { ok: false, client_id: id, row_count: 0, read_count: 0, keyword_rows: 0, shared_rows: 0, truncated: false, covered_start: null, covered_end: null, error_vi: null, note_vi: null };
  if (!CLIENT_ID_RE.test(id)) return { ...base, error_vi: "Tài khoản không hợp lệ." };
  const customerId = customerIdFor(id);
  if (customerId.length !== 10) return { ...base, error_vi: "Không suy ra Customer ID từ tài khoản." };
  const cfg = opts.cfg || (await resolveAdsConfig());
  if (!cfg.ready) {
    return { ...base, error_vi: `Chưa cấu hình Google Ads API. Thiếu: ${cfg.missing.map((m) => m.label_vi).join(" ")}` };
  }
  let coveredStart: string | null = null;
  try {
    const meta = await pullMeta(cfg, customerId, id);
    const tz = meta.timezone || "Asia/Saigon";
    const today = ymdInTz(tz);
    const startYmd = addDaysYmd(today, -WINDOW_DAYS);
    const endYmd = addDaysYmd(today, 1);
    coveredStart = localToOffsetIso(`${startYmd} 00:00:00`, tz);

    // Keyword-level changes, newest first; page by the oldest timestamp when a page is full.
    const pending: Pending[] = [];
    const seen = new Set<string>();
    let pageEnd = endYmd;
    let truncated = false;
    let withNames = true;
    for (let page = 0; page < MAX_PAGES; page++) {
      let rows: GaqlRow[];
      try {
        rows = await searchLeaf(cfg, customerId, changeEventQuery(startYmd, pageEnd, withNames));
      } catch (err) {
        // If Google refuses the campaign / ad group name join, retry once without it.
        if (withNames && err instanceof AdsApiError && err.kind === "BAD_QUERY") {
          withNames = false;
          rows = await searchLeaf(cfg, customerId, changeEventQuery(startYmd, pageEnd, false));
        } else throw err;
      }
      for (const r of rows) {
        const p = toPending(r);
        if (!p) continue;
        const key = `${p.resourceName}|${p.local}|${p.operation}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pending.push(p);
      }
      if (rows.length < PAGE_LIMIT) break;
      const oldest = pending[pending.length - 1]?.local;
      if (!oldest || oldest.slice(0, 19) === pageEnd.slice(0, 19)) {
        truncated = true;
        break;
      }
      pageEnd = oldest.slice(0, 19);
      if (page === MAX_PAGES - 1) truncated = true;
    }
    if (truncated && pending.length) {
      // Only the newest part is complete: coverage starts at the oldest row read.
      coveredStart = localToOffsetIso(pending[pending.length - 1].local, tz);
    }

    const needInfo = pending
      .filter((p) => !(p.newC.text || p.oldC.text) || !(p.newC.type || p.oldC.type))
      .map((p) => p.resourceName);
    const extra = await enrichCriteria(cfg, customerId, [...new Set(needInfo)]);
    const events: EventRow[] = [];
    for (const p of pending) {
      const ev = classify(p, extra.get(p.resourceName));
      if (ev !== "skip") events.push(ev);
    }
    await fillNames(cfg, customerId, events);

    const keywordRows = events.length;
    let sharedRows = 0;
    let note: string | null = null;
    try {
      const shared = await pullSharedLists(cfg, customerId, startYmd, today);
      sharedRows = shared.length;
      events.push(...shared);
    } catch (err) {
      note = `Không đọc được danh sách phủ định chung: ${errorVi(err)}`;
    }

    const written = await upsertEvents(id, customerId, tz, events);
    if (truncated) note = [note, "Quá 30.000 thay đổi — chỉ lưu phần mới nhất."].filter(Boolean).join(" ");
    const coveredEnd = await recordPull({
      clientId: id,
      customerId,
      coveredStart,
      ok: true,
      rowCount: written,
      truncated,
      trigger: opts.trigger,
      actor: opts.actor,
      error: null,
      note,
    });
    return {
      ...base,
      ok: true,
      row_count: written,
      read_count: pending.length,
      keyword_rows: keywordRows,
      shared_rows: sharedRows,
      truncated, covered_start: coveredStart, covered_end: coveredEnd, note_vi: note };
  } catch (err) {
    const msg = errorVi(err);
    await recordPull({
      clientId: id,
      customerId,
      coveredStart: null,
      ok: false,
      rowCount: 0,
      truncated: false,
      trigger: opts.trigger,
      actor: opts.actor,
      error: msg,
      note: null,
    }).catch(() => null);
    return { ...base, error_vi: msg };
  }
}

// ── read ────────────────────────────────────────────────────────────────────────

type DbEvent = {
  id: number;
  client_id: string;
  change_date_time: Date | string;
  source: string;
  action: string;
  criterion_kind: string;
  level: string;
  keyword_text: string | null;
  match_type: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  ad_group_id: string | null;
  ad_group_name: string | null;
  shared_set_name: string | null;
  user_email: string | null;
  client_type: string | null;
  old_status: string | null;
  new_status: string | null;
  old_bid_micros: number | string | null;
  new_bid_micros: number | string | null;
};

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toNum(v: number | string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type ChangeLogAccount = { client_id: string; label: string; customer_id_dashed: string };

/** Rows + per-account summary for [start, end] (Asia/Saigon days). Caller has checked access. */
export async function readChangeLog(
  accounts: ChangeLogAccount[],
  start: string,
  end: string,
  drill: ChangeDrill | null = null,
): Promise<ChangeLogRead> {
  const empty: ChangeLogRead = { start, end, rows: [], truncated: false, accounts: [], users: [], drill };
  if (!YMD_RE.test(start) || !YMD_RE.test(end) || end < start) return empty;
  const ids = accounts.map((a) => a.client_id).filter((id) => CLIENT_ID_RE.test(id));
  const rangeStart = saigonStart(start);
  const rangeEnd = saigonStart(addDaysYmd(end, 1));
  const sql = await getSql();
  let rows: DbEvent[] = [];
  let counts: Array<{ client_id: string; action: string; n: number }> = [];
  let users: Array<{ user_email: string }> = [];
  let pulls: Array<{ client_id: string; covered_start: Date | string | null; covered_end: Date | string | null }> = [];
  let last: Array<{ client_id: string; pulled_at: Date | string; ok: boolean; error_vi: string | null }> = [];
  if (ids.length) {
    try {
      [rows, counts, users, pulls, last] = await Promise.all([
        sql.query<DbEvent>(
          `select id, client_id, change_date_time, source, action, criterion_kind, level, keyword_text, match_type,
                  campaign_id, campaign_name, ad_group_id, ad_group_name, shared_set_name, user_email, client_type,
                  old_status, new_status, old_bid_micros, new_bid_micros
           from ads_change_events
           where client_id = any($1::text[]) and change_date_time >= $2::timestamptz and change_date_time < $3::timestamptz
             ${drill ? "and client_id = $4 and action = any($5::text[])" : ""}
           order by change_date_time desc
           limit ${READ_ROW_CAP + 1}`,
          // Drill: exactly the actions the summary counted in that cell (summaryBucketOf).
          drill ? [ids, rangeStart, rangeEnd, drill.client_id, actionsInBucket(drill.bucket)] : [ids, rangeStart, rangeEnd],
        ),
        sql.query<{ client_id: string; action: string; n: number }>(
          `select client_id, action, count(*)::int as n from ads_change_events
           where client_id = any($1::text[]) and change_date_time >= $2::timestamptz and change_date_time < $3::timestamptz
           group by client_id, action`,
          [ids, rangeStart, rangeEnd],
        ),
        sql.query<{ user_email: string }>(
          `select distinct user_email from ads_change_events
           where client_id = any($1::text[]) and change_date_time >= $2::timestamptz and change_date_time < $3::timestamptz
             and user_email is not null and user_email <> ''
           order by user_email`,
          [ids, rangeStart, rangeEnd],
        ),
        sql.query<{ client_id: string; covered_start: Date | string | null; covered_end: Date | string | null }>(
          `select client_id, covered_start, covered_end from ads_change_pulls
           where client_id = any($1::text[]) and ok and covered_start is not null and covered_end is not null
             and covered_end > $2::timestamptz and covered_start < $3::timestamptz`,
          [ids, rangeStart, rangeEnd],
        ),
        sql.query<{ client_id: string; pulled_at: Date | string; ok: boolean; error_vi: string | null }>(
          `select distinct on (client_id) client_id, pulled_at, ok, error_vi from ads_change_pulls
           where client_id = any($1::text[]) order by client_id, pulled_at desc`,
          [ids],
        ),
      ]);
    } catch {
      // Table not created yet (migration not applied): everything is "chưa kéo".
    }
  }

  const now = Date.now();
  const days: Array<{ s: number; e: number }> = [];
  for (let d = start; d <= end; d = addDaysYmd(d, 1)) {
    const s = Date.parse(saigonStart(d));
    const e = Math.min(Date.parse(saigonStart(addDaysYmd(d, 1))), now);
    if (s < now) days.push({ s, e });
  }
  const summaries: ChangeAccountSummary[] = accounts.map((a) => {
    const mine = pulls
      .filter((p) => p.client_id === a.client_id)
      .map((p) => ({ s: Date.parse(iso(p.covered_start) || ""), e: Date.parse(iso(p.covered_end) || "") }))
      .filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e));
    let full = 0;
    let touched = 0;
    let through = 0;
    for (const day of days) {
      const overlap = mine.filter((p) => p.s <= day.s && p.e > day.s);
      if (overlap.length) touched += 1;
      if (overlap.some((p) => p.e >= day.e)) full += 1;
      for (const p of overlap) through = Math.max(through, Math.min(p.e, day.e));
    }
    const coverage: AccountCoverage = !touched ? "not_pulled" : full === days.length ? "full" : "partial";
    const lp = last.find((l) => l.client_id === a.client_id);
    let summary: ChangeAccountSummary["counts"] = null;
    if (coverage !== "not_pulled") {
      summary = { add_keyword: 0, add_negative: 0, pause_remove: 0, bid_change: 0, shared: 0, other: 0, optimization_total: 0 };
      for (const c of counts.filter((x) => x.client_id === a.client_id)) {
        const action = c.action as ChangeAction;
        const n = Number(c.n) || 0;
        summary[summaryBucketOf(action)] += n;
        if (isOptimization(action)) summary.optimization_total += n;
      }
    }
    return {
      client_id: a.client_id,
      label: a.label,
      customer_id_dashed: a.customer_id_dashed,
      coverage,
      covered_through: through ? new Date(through).toISOString() : null,
      last_pull_at: lp ? iso(lp.pulled_at) : null,
      last_pull_ok: lp ? Boolean(lp.ok) : null,
      last_error_vi: lp && !lp.ok ? lp.error_vi : null,
      counts: summary,
    };
  });

  const outRows: ChangeRow[] = rows.slice(0, READ_ROW_CAP).map((r) => ({
    id: Number(r.id),
    client_id: r.client_id,
    at: iso(r.change_date_time) || "",
    source: r.source === "change_status" ? "change_status" : "change_event",
    action: r.action as ChangeAction,
    kind: r.criterion_kind as ChangeRow["kind"],
    level: r.level as ChangeRow["level"],
    keyword_text: r.keyword_text,
    match_type: r.match_type,
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    ad_group_id: r.ad_group_id,
    ad_group_name: r.ad_group_name,
    shared_set_name: r.shared_set_name,
    user_email: r.user_email,
    client_type: r.client_type,
    old_status: r.old_status,
    new_status: r.new_status,
    old_bid_micros: toNum(r.old_bid_micros),
    new_bid_micros: toNum(r.new_bid_micros),
  }));
  return {
    start,
    end,
    rows: outRows,
    truncated: rows.length > READ_ROW_CAP,
    accounts: summaries,
    users: users.map((u) => u.user_email),
    drill,
  };
}

/** Accounts for the daily cron: every roster account with a Google CID, least recently pulled first. */
export async function cronAccounts(all: Array<{ client_id: string; customer_id_dashed?: string }>): Promise<string[]> {
  const ids = all.map((c) => c.client_id);
  let lastBy = new Map<string, number>();
  try {
    const sql = await getSql();
    // Accounts pulled from every MCC live in Neon ad_accounts, not in the file roster.
    const pulled = await sql.query<{ id: string }>(
      `select id from ad_accounts where platform = 'google' and manager_customer_id is not null and btrim(manager_customer_id) <> ''`,
    );
    ids.push(...pulled.map((r) => r.id));
  } catch {
    /* column appears on the first MCC pull */
  }
  const valid = ids.filter((id) => CLIENT_ID_RE.test(id) && customerIdFor(id).length === 10);
  ids.length = 0;
  ids.push(...valid);
  try {
    const sql = await getSql();
    const rows = await sql.query<{ client_id: string; pulled_at: Date | string }>(
      `select client_id, max(pulled_at) as pulled_at from ads_change_pulls where client_id = any($1::text[]) group by client_id`,
      [ids],
    );
    lastBy = new Map(rows.map((r) => [r.client_id, Date.parse(iso(r.pulled_at) || "") || 0]));
  } catch {
    /* new table */
  }
  return [...new Set(ids)].sort((a, b) => (lastBy.get(a) || 0) - (lastBy.get(b) || 0));
}


// ── on-view auto-pull (read-only cache fill, any staff viewer) ───────────────────

export const AUTO_PULL_STALE_MS = 6 * 60 * 60 * 1000;
const AUTO_PULL_ERROR_MS = 30 * 60 * 1000;

export type ChangeAutoPullResult = { state: "fresh" | "cooldown" | "busy" | "pulled" | "error"; error_vi?: string | null };

/**
 * Pull one account's change log when the last successful pull is older than 6 h.
 * Guards: Neon lock `<client>:changelog` (one in flight), 30 min after a failed attempt.
 */
export async function autoPullChangeLog(clientId: string, actor: string | null): Promise<ChangeAutoPullResult> {
  const id = clientId.trim();
  if (!CLIENT_ID_RE.test(id) || customerIdFor(id).length !== 10) return { state: "error", error_vi: "Tài khoản không hợp lệ." };
  try {
    const sql = await getSql();
    const r = await sql.query<{ ok_at: Date | string | null; fail_at: Date | string | null }>(
      `select max(pulled_at) filter (where ok) as ok_at, max(pulled_at) filter (where not ok) as fail_at
       from ads_change_pulls where client_id = $1`,
      [id],
    );
    const okAt = Date.parse(iso(r[0]?.ok_at) || "") || 0;
    const failAt = Date.parse(iso(r[0]?.fail_at) || "") || 0;
    if (Date.now() - okAt < AUTO_PULL_STALE_MS) return { state: "fresh" };
    if (failAt > okAt && Date.now() - failAt < AUTO_PULL_ERROR_MS) return { state: "cooldown" };
  } catch {
    return { state: "error", error_vi: "Chưa có bảng nhật ký." };
  }
  const key = `${id}:changelog`;
  if (!(await acquireLock(key, 120))) return { state: "busy" };
  try {
    const res = await pullChangeLog(id, { trigger: "auto", actor });
    return res.ok ? { state: "pulled" } : { state: "error", error_vi: res.error_vi };
  } finally {
    await releaseLock(key);
  }
}
