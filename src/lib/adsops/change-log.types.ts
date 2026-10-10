/**
 * Keyword optimization change log ("Nhật ký tối ưu") — shared types and labels.
 * No server imports: used by the server functions and the UI.
 */

export type ChangeAction =
  | "add_keyword"
  | "add_negative"
  | "remove_keyword"
  | "remove_negative"
  | "pause"
  | "enable"
  | "bid_change"
  | "other_update"
  | "shared_list_created"
  | "shared_list_changed"
  | "shared_list_removed"
  | "shared_list_attached"
  | "shared_list_detached"
  | "other";

export type ChangeKind = "keyword" | "negative" | "shared_negative" | "other";
export type ChangeLevel = "ad_group" | "campaign" | "shared";

/** Filter groups shown as "Loại". */
export type ChangeCategory = "add_keyword" | "negative" | "pause_remove" | "bid" | "other";

export const ACTION_LABEL_VI: Record<ChangeAction, string> = {
  add_keyword: "Thêm từ khoá",
  add_negative: "Thêm phủ định",
  remove_keyword: "Xoá từ khoá",
  remove_negative: "Xoá phủ định",
  pause: "Tạm dừng",
  enable: "Bật lại",
  bid_change: "Đổi giá thầu",
  other_update: "Sửa khác",
  shared_list_created: "Tạo DS phủ định chung",
  shared_list_changed: "Sửa DS phủ định chung",
  shared_list_removed: "Xoá DS phủ định chung",
  shared_list_attached: "Gắn DS phủ định chung",
  shared_list_detached: "Gỡ DS phủ định chung",
  other: "Khác",
};

export const CATEGORY_LABEL_VI: Record<ChangeCategory, string> = {
  add_keyword: "Thêm từ khoá",
  negative: "Phủ định",
  pause_remove: "Tạm dừng/Xoá",
  bid: "Đổi giá thầu",
  other: "Khác",
};

export const LEVEL_LABEL_VI: Record<ChangeLevel, string> = {
  ad_group: "Nhóm",
  campaign: "Chiến dịch",
  shared: "Danh sách chung",
};

export const MATCH_LABEL_VI: Record<string, string> = {
  EXACT: "Chính xác",
  PHRASE: "Cụm từ",
  BROAD: "Rộng",
};

export function categoryOf(action: ChangeAction): ChangeCategory {
  switch (action) {
    case "add_keyword":
      return "add_keyword";
    case "add_negative":
    case "remove_negative":
    case "shared_list_created":
    case "shared_list_changed":
    case "shared_list_removed":
    case "shared_list_attached":
    case "shared_list_detached":
      return "negative";
    case "pause":
    case "remove_keyword":
      return "pause_remove";
    case "bid_change":
      return "bid";
    default:
      return "other";
  }
}

/** Actions that count as keyword optimization work (everything except "Khác"). */
export function isOptimization(action: ChangeAction): boolean {
  return categoryOf(action) !== "other" || action === "enable";
}

export type ChangeRow = {
  id: number;
  client_id: string;
  /** ISO timestamp (UTC). The UI formats it in Asia/Saigon. */
  at: string;
  source: "change_event" | "change_status";
  action: ChangeAction;
  kind: ChangeKind;
  level: ChangeLevel;
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
  old_bid_micros: number | null;
  new_bid_micros: number | null;
};

export type AccountCoverage = "not_pulled" | "partial" | "full";

export type ChangeAccountSummary = {
  client_id: string;
  label: string;
  customer_id_dashed: string;
  coverage: AccountCoverage;
  /** Latest covered moment inside the range (ISO), when any. */
  covered_through: string | null;
  last_pull_at: string | null;
  last_pull_ok: boolean | null;
  last_error_vi: string | null;
  /** Null when nothing was pulled for the range (never a fake zero). */
  counts: {
    add_keyword: number;
    add_negative: number;
    pause_remove: number;
    bid_change: number;
    shared: number;
    other: number;
    optimization_total: number;
  } | null;
};

export type ChangeLogRead = {
  start: string;
  end: string;
  rows: ChangeRow[];
  /** More rows exist than were returned (the summary still counts all of them). */
  truncated: boolean;
  accounts: ChangeAccountSummary[];
  users: string[];
};

export type ChangeLogPullResult = {
  ok: boolean;
  client_id: string;
  /** Rows written to Neon (keyword rows + shared-list rows). */
  row_count: number;
  /** change_event rows Google returned (all criterion types). */
  read_count: number;
  /** Keyword / negative rows stored (location, audience… criteria are skipped). */
  keyword_rows: number;
  /** Shared negative list rows stored (change_status). */
  shared_rows: number;
  truncated: boolean;
  covered_start: string | null;
  covered_end: string | null;
  error_vi: string | null;
  note_vi: string | null;
};
