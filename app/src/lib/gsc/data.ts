import "server-only";
import { sql } from "kysely";
import { getDb } from "@/lib/db";
import { normalizeKeyword } from "@/seo/normalize";

/**
 * Reading Search Console rows (gsc_daily, see ./import.ts for the row layout) for the
 * dashboard, the overview, reports and the REST API.
 */

export interface GscTotals {
  clicks: number;
  impressions: number;
  /** 0–1 */
  ctr: number;
  /** Impression-weighted average position; null without impressions. */
  position: number | null;
}

export interface GscDay extends GscTotals {
  day: string;
}

export interface GscTopRow extends GscTotals {
  key: string;
}

const EMPTY: GscTotals = { clicks: 0, impressions: 0, ctr: 0, position: null };

function totalsOf(clicks: number, impressions: number, weighted: number): GscTotals {
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? Math.round((weighted / impressions) * 10) / 10 : null,
  };
}

/** True when the project has any Search Console rows. */
export async function hasGscData(projectId: number): Promise<boolean> {
  const db = await getDb();
  return Boolean(await db.selectFrom("gsc_daily").select("id").where("project_id", "=", projectId).limit(1).executeTakeFirst());
}

/** Newest day with data, or null. */
export async function lastGscDay(projectId: number): Promise<string | null> {
  const db = await getDb();
  const row = await db.selectFrom("gsc_daily").select("day").where("project_id", "=", projectId).orderBy("day", "desc").limit(1).executeTakeFirst();
  return row?.day ?? null;
}

/**
 * Daily totals for [fromDay, toDay] (missing days are zero). Uses the totals rows; days without
 * one (e.g. data inserted by hand) are summed from their query rows.
 */
export async function getGscDaily(projectId: number, fromDay: string, toDay: string): Promise<GscDay[]> {
  const db = await getDb();
  const daily = (totalsOnly: boolean) =>
    db
      .selectFrom("gsc_daily")
      .select(["day", (eb) => eb.fn.sum<number>("clicks").as("clicks"), (eb) => eb.fn.sum<number>("impressions").as("impressions"), sql<number>`sum(position * impressions)`.as("weighted")])
      .where("project_id", "=", projectId)
      .where("day", ">=", fromDay)
      .where("day", "<=", toDay)
      .where("page", "=", "")
      .where("query", totalsOnly ? "=" : "!=", "")
      .groupBy("day")
      .execute();
  const [totalRows, queryRows] = await Promise.all([daily(true), daily(false)]);
  const toMap = (rows: typeof totalRows) => new Map(rows.map((r) => [r.day, totalsOf(Number(r.clicks ?? 0), Number(r.impressions ?? 0), Number(r.weighted ?? 0))]));
  const total = toMap(totalRows);
  const fromQueries = toMap(queryRows);
  const out: GscDay[] = [];
  for (let d = fromDay; d <= toDay; d = nextDay(d)) out.push({ day: d, ...(total.get(d) ?? fromQueries.get(d) ?? EMPTY) });
  return out;
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Totals of a period from daily rows. */
export function sumDays(days: GscTotals[]): GscTotals {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const d of days) {
    clicks += d.clicks;
    impressions += d.impressions;
    weighted += (d.position ?? 0) * d.impressions;
  }
  return totalsOf(clicks, impressions, weighted);
}

export async function getGscTotals(projectId: number, fromDay: string, toDay: string): Promise<GscTotals> {
  return sumDays(await getGscDaily(projectId, fromDay, toDay));
}

/** Top queries or pages of a period (summed over its days), by clicks then impressions. */
export async function getGscTop(projectId: number, kind: "query" | "page", fromDay: string, toDay: string, limit = 1000): Promise<GscTopRow[]> {
  const db = await getDb();
  const key = kind === "query" ? "query" : "page";
  const other = kind === "query" ? "page" : "query";
  const rows = await db
    .selectFrom("gsc_daily")
    .select([
      sql<string>`${sql.ref(key)}`.as("key"),
      (eb) => eb.fn.sum<number>("clicks").as("clicks"),
      (eb) => eb.fn.sum<number>("impressions").as("impressions"),
      sql<number>`sum(position * impressions)`.as("weighted"),
    ])
    .where("project_id", "=", projectId)
    .where("day", ">=", fromDay)
    .where("day", "<=", toDay)
    .where(key, "!=", "")
    .where(other, "=", "")
    .groupBy(key)
    .orderBy("clicks", "desc")
    .orderBy("impressions", "desc")
    .limit(Math.max(1, Math.min(limit, 5000)))
    .execute();
  return rows.map((r) => ({ key: r.key, ...totalsOf(Number(r.clicks ?? 0), Number(r.impressions ?? 0), Number(r.weighted ?? 0)) }));
}

/**
 * Search Console numbers for tracked phrases (a free second rank source next to the tracked
 * positions): normalised phrase → totals of the last `days` days.
 */
export async function getGscForPhrases(projectId: number, phrases: string[], days = 28, toDay = new Date().toISOString().slice(0, 10)): Promise<Map<string, GscTotals>> {
  const wanted = new Set(phrases.map(normalizeKeyword).filter(Boolean));
  const out = new Map<string, GscTotals>();
  if (!wanted.size) return out;
  const from = new Date(Date.parse(`${toDay}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  for (const row of await getGscTop(projectId, "query", from, toDay, 5000)) {
    const k = normalizeKeyword(row.key);
    if (wanted.has(k) && !out.has(k)) out.set(k, row);
  }
  return out;
}
