import "server-only";
import { getDb, now, today } from "@/lib/db";
import { addDays, chunk, writeKey } from "@/lib/jobs/shared";
import { getAccessToken, dropAccessToken } from "./connections";
import { GoogleApiError, queryAnalytics, type GscApiRow, type GscDimension } from "./google";

/**
 * Search Console import (gsc_daily).
 *
 * Rows per project and day, all from searchanalytics.query with dataState "final":
 *   - query = "" and page = ""  → the day's totals (dimension date only, exact numbers)
 *   - page  = ""                → one search query (dimensions date + query), top QUERY_ROWS per day
 *   - query = ""                → one page (dimensions date + page), top PAGE_ROWS per day
 * ("" stands for "not split by this dimension"; the columns are NOT NULL.)
 * Top rows are picked by clicks, then impressions. Search Console keeps 16 months: older rows
 * are deleted by the job.
 *
 * When a property is assigned, the last BACKFILL_DAYS days are imported newest first, one
 * WINDOW_DAYS window per step; afterwards the job re-imports the last DAILY_DAYS days once a day
 * (final data lags 2–3 days behind). A day is only replaced when Google returned data for it.
 *
 * Progress is kept in a settings row "gsc_state:<project id>" (GscImportState).
 */

export const QUERY_ROWS = 250;
export const PAGE_ROWS = 100;
export const BACKFILL_DAYS = 90;
export const DAILY_DAYS = 3;
export const WINDOW_DAYS = 10;
/** Most recent day requested (final data is about 2 days behind). */
export const LAG_DAYS = 2;
export const RETENTION_DAYS = 490;

export interface GscImportState {
  /** Property the state belongs to (a new property restarts the backfill). */
  property: string;
  /** Oldest day of the backfill. */
  backfillFrom: string;
  /** Newest day not imported yet by the backfill (it walks backwards); null when done. */
  backfillCursor: string | null;
  lastDailyAt: string | null;
  lastImportAt: string | null;
  lastError: string | null;
  /** Don't try before this time (quota, network or permission errors). */
  retryAt: string | null;
  /** Rows stored by the last import step. */
  rows: number;
}

const stateKey = (projectId: number) => `gsc_state:${projectId}`;

export async function readImportState(projectId: number): Promise<GscImportState | null> {
  const db = await getDb();
  const row = await db.selectFrom("settings").select("value").where("key", "=", stateKey(projectId)).executeTakeFirst();
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value) as GscImportState;
    return v && typeof v === "object" && typeof v.property === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function writeImportState(projectId: number, state: GscImportState | null): Promise<void> {
  if (!state) {
    const db = await getDb();
    await db.deleteFrom("settings").where("key", "=", stateKey(projectId)).execute();
    return;
  }
  await writeKey(stateKey(projectId), JSON.stringify(state));
}

/** A fresh state: backfill BACKFILL_DAYS days ending LAG_DAYS ago. */
export function newImportState(property: string, day = today()): GscImportState {
  const end = addDays(day, -LAG_DAYS);
  return { property, backfillFrom: addDays(end, -(BACKFILL_DAYS - 1)), backfillCursor: end, lastDailyAt: null, lastImportAt: null, lastError: null, retryAt: null, rows: 0 };
}

/** The next window to import for a state, or null when nothing is due. */
export function nextWindow(state: GscImportState, nowMs = Date.now()): { from: string; to: string; kind: "backfill" | "daily" } | null {
  if (state.retryAt && Date.parse(state.retryAt) > nowMs) return null;
  if (state.backfillCursor && state.backfillCursor >= state.backfillFrom) {
    const to = state.backfillCursor;
    const from = addDays(to, -(WINDOW_DAYS - 1)) < state.backfillFrom ? state.backfillFrom : addDays(to, -(WINDOW_DAYS - 1));
    return { from, to, kind: "backfill" };
  }
  if (!state.lastDailyAt || nowMs - Date.parse(state.lastDailyAt) >= 20 * 3_600_000) {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const to = addDays(day, -LAG_DAYS);
    return { from: addDays(to, -(DAILY_DAYS - 1)), to, kind: "daily" };
  }
  return null;
}

/** API call with one retry after a 401 (expired access token). */
async function query(connectionId: number, property: string, from: string, to: string, dimensions: GscDimension[]): Promise<GscApiRow[]> {
  const run = async () => queryAnalytics(await getAccessToken(connectionId), property, { startDate: from, endDate: to, dimensions, rowLimit: 25_000, maxRows: 100_000 });
  try {
    return await run();
  } catch (error) {
    if (error instanceof GoogleApiError && error.kind === "auth") {
      dropAccessToken(connectionId);
      return run();
    }
    throw error;
  }
}

interface Row {
  day: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function topPerDay(rows: GscApiRow[], limit: number, kind: "query" | "page"): Row[] {
  const byDay = new Map<string, GscApiRow[]>();
  for (const r of rows) {
    const [day, key] = r.keys;
    if (!day || !key) continue;
    const list = byDay.get(day) ?? [];
    list.push(r);
    byDay.set(day, list);
  }
  const out: Row[] = [];
  for (const [day, list] of byDay) {
    list.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.keys[1].localeCompare(b.keys[1]));
    for (const r of list.slice(0, limit)) {
      out.push({
        day,
        query: kind === "query" ? r.keys[1].slice(0, 500) : "",
        page: kind === "page" ? r.keys[1].slice(0, 1000) : "",
        clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        ctr: r.ctr,
        position: r.position,
      });
    }
  }
  return out;
}

/**
 * Import one window of days for a project: totals, top queries and top pages per day. Days
 * Google returned data for are replaced in one transaction. Returns the rows stored.
 */
export async function importWindow(project: { id: number; property: string; connectionId: number }, from: string, to: string): Promise<number> {
  const totals = await query(project.connectionId, project.property, from, to, ["date"]);
  const queries = await query(project.connectionId, project.property, from, to, ["date", "query"]);
  const pages = await query(project.connectionId, project.property, from, to, ["date", "page"]);
  const rows: Row[] = [
    ...totals.filter((r) => r.keys[0]).map((r) => ({ day: r.keys[0], query: "", page: "", clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position })),
    ...topPerDay(queries, QUERY_ROWS, "query"),
    ...topPerDay(pages, PAGE_ROWS, "page"),
  ].filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && r.day >= from && r.day <= to);
  const days = [...new Set(rows.map((r) => r.day))];
  if (!days.length) return 0;
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("gsc_daily").where("project_id", "=", project.id).where("day", "in", days).execute();
    for (const part of chunk(rows, 200)) {
      await trx
        .insertInto("gsc_daily")
        .values(part.map((r) => ({ project_id: project.id, day: r.day, query: r.query, page: r.page, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })))
        .execute();
    }
  });
  return rows.length;
}

export type StepResult = { ok: true; rows: number; done: boolean } | { ok: false; error: GoogleApiError | Error };

/** Retry delay after an import error, by kind. */
function retryDelayMs(error: unknown): number {
  if (error instanceof GoogleApiError) {
    if (error.kind === "quota") return 30 * 60_000;
    if (error.kind === "permission") return 6 * 3_600_000;
    if (error.kind === "revoked" || error.kind === "config") return 12 * 3_600_000;
  }
  return 15 * 60_000;
}

/**
 * Run the next due import step of a project (one backfill window or the daily refresh) and
 * save its progress. Returns null when nothing was due.
 */
export async function runImportStep(project: { id: number; property: string; connectionId: number }, nowMs = Date.now()): Promise<StepResult | null> {
  let state = await readImportState(project.id);
  if (!state || state.property !== project.property) state = newImportState(project.property, new Date(nowMs).toISOString().slice(0, 10));
  const window = nextWindow(state, nowMs);
  if (!window) {
    await writeImportState(project.id, state);
    return null;
  }
  try {
    const rows = await importWindow(project, window.from, window.to);
    const ts = now();
    if (window.kind === "backfill") {
      const next = addDays(window.from, -1);
      state.backfillCursor = next >= state.backfillFrom ? next : null;
      if (!state.backfillCursor) state.lastDailyAt = ts;
    } else {
      state.lastDailyAt = ts;
    }
    state.lastImportAt = ts;
    state.lastError = null;
    state.retryAt = null;
    state.rows = rows;
    await writeImportState(project.id, state);
    return { ok: true, rows, done: !state.backfillCursor };
  } catch (error) {
    state.lastError = (error instanceof Error ? error.message : "Import failed").slice(0, 300);
    state.retryAt = new Date(nowMs + retryDelayMs(error)).toISOString();
    await writeImportState(project.id, state);
    return { ok: false, error: error instanceof Error ? error : new Error("Import failed") };
  }
}

/** Delete rows older than Search Console's 16 months. */
export async function pruneOldRows(): Promise<number> {
  const db = await getDb();
  const res = await db.deleteFrom("gsc_daily").where("day", "<", addDays(today(), -RETENTION_DAYS)).executeTakeFirst();
  return Number(res.numDeletedRows ?? 0);
}
