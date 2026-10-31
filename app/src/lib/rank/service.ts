import "server-only";
import type { Entitlements } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";
import { checkItemsNow, loadCheckItems, type RunSummary } from "./check";
import { getKeywordHistoryRows, getRankSummary, type HistoryPoint, type RankSummary } from "./queries";

/**
 * Rank tracking service for other modules (REST API /api/v1, reports, overview dashboard).
 * Callers are responsible for authorisation: pass `userId` to restrict to one account.
 */

export type { HistoryPoint, RankSummary, SeriesPoint } from "./queries";

/** Manual checks of a keyword are refused within this time after its last check. */
export const CHECK_NOW_COOLDOWN_MS = 10 * 60_000;
/** Keywords per "check now" request. */
export const CHECK_NOW_MAX = 100;
/** "Check now" requests per account (dashboard and API together) within CHECK_NOW_BURST_MS. */
export const CHECK_NOW_BURST = 6;
export const CHECK_NOW_BURST_MS = 10 * 60_000;

/** Manual checks per account and day (dashboard and API together): the plan's keyword limit, at least 25; 500 when unlimited. */
export function manualCheckDailyCap(entitlements: Pick<Entitlements, "maxKeywords">): number {
  return entitlements.maxKeywords > 0 ? Math.max(25, entitlements.maxKeywords) : 500;
}

/**
 * Count one "check now" request of `count` keywords against the account's limits, shared by the
 * dashboard and the REST API: CHECK_NOW_BURST requests per 10 minutes and the daily cap of manual
 * checks. Returns "rate" or "daily" (with the cap) when a limit is reached.
 */
export function takeManualChecks(userId: number, entitlements: Pick<Entitlements, "maxKeywords">, count: number): { ok: true } | { ok: false; reason: "rate" | "daily"; cap: number } {
  const cap = manualCheckDailyCap(entitlements);
  if (!rateLimit(`sz-kw-check:${userId}`, CHECK_NOW_BURST, CHECK_NOW_BURST_MS)) return { ok: false, reason: "rate", cap };
  for (let i = 0; i < count; i++) {
    if (!rateLimit(`sz-kw-check-day:${userId}`, cap, 24 * 60 * 60_000)) return { ok: false, reason: "daily", cap };
  }
  return { ok: true };
}

export interface CheckNowResult extends RunSummary {
  /** "no_provider": no SERP provider configured; "paused": checks are paused after a provider error. */
  error?: "no_provider" | "paused";
  /** Ids that were not checked: unknown / other account / paused keyword or project / checked < 10 min ago. */
  skippedIds: number[];
}

/**
 * Check keywords now with the active provider (the same pipeline as scheduled checks: rankings,
 * best/start positions, snapshots, usage, alerts). Only active keywords of active projects whose
 * owner is active are checked; a keyword checked in the last 10 minutes is skipped.
 * Waits for the checks (up to `budgetMs`, default 25 s) and returns what happened.
 */
export async function checkKeywordsNow(ids: number[], options: { userId?: number; budgetMs?: number } = {}): Promise<CheckNowResult> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, CHECK_NOW_MAX);
  const items = (await loadCheckItems(clean)).filter(
    (i) =>
      (options.userId === undefined || i.project.userId === options.userId) &&
      i.keyword.status === "active" &&
      !(i.keyword.last_checked_at && Date.now() - Date.parse(i.keyword.last_checked_at) < CHECK_NOW_COOLDOWN_MS),
  );
  const taken = new Set(items.map((i) => i.keyword.id));
  const skippedIds = [...new Set(ids)].filter((id) => !taken.has(id));
  if (!items.length) return { checked: 0, failed: 0, skipped: skippedIds.length, alerts: 0, stopped: null, skippedIds };
  const result = await checkItemsNow(items, options.budgetMs);
  return { ...result, skipped: result.skipped + skippedIds.length, skippedIds };
}

/** Daily positions of a keyword for the last `days` days, oldest first (no ownership check). */
export async function getKeywordHistory(keywordId: number, days = 30): Promise<HistoryPoint[]> {
  if (!Number.isInteger(keywordId) || keywordId < 1) return [];
  return getKeywordHistoryRows(keywordId, Math.min(Math.max(1, Math.round(days)), 400));
}

/**
 * Rank KPIs of a project (keywords, ranked, top 3/10/100, average position, visibility, movers
 * up/down since `days` ago) with a daily visibility / average-position series (no ownership check).
 */
export async function getProjectRankSummary(projectId: number, days = 30): Promise<RankSummary> {
  return getRankSummary(projectId, Math.min(Math.max(2, Math.round(days)), 400));
}
