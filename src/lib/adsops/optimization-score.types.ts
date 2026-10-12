/** "Điểm tối ưu hoá" — shared types and pure helpers (no server imports). */

export const SCORE_RED = 0.7;
export const SCORE_AMBER = 0.85;

export type ScoreTone = "red" | "amber" | "green" | "none";

export function scoreTone(score: number | null | undefined): ScoreTone {
  if (score == null || !Number.isFinite(score)) return "none";
  if (score < SCORE_RED) return "red";
  if (score < SCORE_AMBER) return "amber";
  return "green";
}

export type ScorePoint = { date: string; score: number | null };

export type ScoreRow = {
  client_id: string;
  label: string;
  customer_id_dashed: string;
  /** Latest stored day (account timezone), null = never checked. */
  date: string | null;
  /** 0..1; null = Google has no score (or the check failed: see error_vi). */
  score: number | null;
  checked_at: string | null;
  error_vi: string | null;
  /** Score change (0..1 units) vs exactly N days before `date`; null when that day is not stored. */
  d1: number | null;
  d7: number | null;
  d30: number | null;
  /** Up to the last 30 stored days, oldest first. Never padded before tracking started. */
  series: ScorePoint[];
};

export type ScoreRead = { rows: ScoreRow[] };
export type ScoreCheckResult = { ok: boolean; client_id: string; score: number | null; error_vi: string | null };
