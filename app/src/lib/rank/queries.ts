import "server-only";
import { getDb } from "@/lib/db";
import { dayOf, periodDays } from "@/lib/periods";
import { averagePosition, expectedCtr, normalizeFeatures, parseJson, parseJsonList, positionChange, visibilityScore, type PositionChange } from "@/seo/normalize";
import type { SerpFeature, SerpResult } from "@/seo/types";

/**
 * Read side of rank tracking: history per keyword, project time series (visibility, average
 * position), KPIs, competitor share of voice and SERP snapshots. Used by the Rankings pages,
 * reports and the REST API (see ./service.ts).
 *
 * Keywords checked weekly have one rankings row per week: series carry a keyword's last known
 * position forward for up to CARRY_DAYS days.
 */

const DAY_MS = 86_400_000;
/** A position stays "current" in day-by-day series for this many days after its check. */
export const CARRY_DAYS = 8;

export interface HistoryPoint {
  day: string;
  position: number | null;
  url: string | null;
  features: SerpFeature[];
  /** Competitor domain → position (null = not in the checked depth). */
  competitors: Record<string, number | null>;
  provider: string;
  checkedAt: string;
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v));

function competitorsOf(text: string): Record<string, number | null> {
  const o = parseJson(text);
  const out: Record<string, number | null> = {};
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) out[k] = typeof v === "number" && v > 0 ? v : null;
  }
  return out;
}

/** Daily rankings of one keyword in the last `days` days (oldest first). */
export async function getKeywordHistoryRows(keywordId: number, days: number): Promise<HistoryPoint[]> {
  const db = await getDb();
  const from = dayOf(Date.now() - (Math.max(1, days) - 1) * DAY_MS);
  const rows = await db
    .selectFrom("rankings")
    .select(["day", "position", "url", "features", "competitors", "provider", "checked_at"])
    .where("keyword_id", "=", keywordId)
    .where("day", ">=", from)
    .orderBy("day")
    .execute();
  return rows.map((r) => ({
    day: r.day,
    position: num(r.position),
    url: r.url,
    features: normalizeFeatures(parseJsonList(r.features)),
    competitors: competitorsOf(r.competitors),
    provider: r.provider,
    checkedAt: r.checked_at,
  }));
}

/** keyword id → its rankings (day, position) since `fromDay`, oldest first. */
async function positionRows(keywordIds: number[], fromDay: string): Promise<Map<number, Array<{ day: string; position: number | null }>>> {
  const out = new Map<number, Array<{ day: string; position: number | null }>>();
  if (!keywordIds.length) return out;
  const db = await getDb();
  for (let i = 0; i < keywordIds.length; i += 500) {
    const rows = await db
      .selectFrom("rankings")
      .select(["keyword_id", "day", "position"])
      .where("keyword_id", "in", keywordIds.slice(i, i + 500))
      .where("day", ">=", fromDay)
      .orderBy("day")
      .execute();
    for (const r of rows) {
      let list = out.get(r.keyword_id);
      if (!list) out.set(r.keyword_id, (list = []));
      list.push({ day: r.day, position: num(r.position) });
    }
  }
  return out;
}

export interface KeywordTrend {
  /** Change against the last check on or before 1 / 7 / 30 days ago (null = no earlier check). */
  d1: PositionChange | null;
  d7: PositionChange | null;
  d30: PositionChange | null;
  /** Positions of the last 30 days (days with a check only). */
  spark: Array<{ day: string; position: number | null }>;
}

const addDays = (day: string, n: number) => dayOf(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

/** Changes (1 / 7 / 30 days) and a 30-day sparkline per keyword. */
export async function getKeywordTrends(keywords: Array<{ id: number; lastPosition: number | null; lastCheckedAt: string | null }>): Promise<Map<number, KeywordTrend>> {
  const today = dayOf(Date.now());
  const rows = await positionRows(
    keywords.map((k) => k.id),
    addDays(today, -37),
  );
  const out = new Map<number, KeywordTrend>();
  for (const k of keywords) {
    const list = rows.get(k.id) ?? [];
    const lastDay = k.lastCheckedAt ? k.lastCheckedAt.slice(0, 10) : today;
    const ref = (n: number): PositionChange | null => {
      const limit = addDays(lastDay, -n);
      let found: { position: number | null } | null = null;
      for (const r of list) if (r.day <= limit && r.day < lastDay) found = r;
      return found && k.lastCheckedAt ? positionChange(found.position, k.lastPosition) : null;
    };
    out.set(k.id, { d1: ref(1), d7: ref(7), d30: ref(30), spark: list.filter((r) => r.day > addDays(today, -30)) });
  }
  return out;
}

export interface SeriesPoint {
  day: string;
  /** visibilityScore() of the keywords with a known position that day; null when none. */
  visibility: number | null;
  averagePosition: number | null;
  top10: number;
  /** Keywords with a known position that day. */
  known: number;
}

/** Positions per keyword per day (carried forward up to CARRY_DAYS), for `days` days ending today. */
async function dailyMatrix(keywordIds: number[], days: number): Promise<{ days: string[]; values: Map<number, Array<number | null | undefined>> }> {
  const dayList = periodDays(days);
  const rows = await positionRows(keywordIds, addDays(dayList[0], -CARRY_DAYS));
  const values = new Map<number, Array<number | null | undefined>>();
  for (const id of keywordIds) {
    const list = rows.get(id) ?? [];
    const out: Array<number | null | undefined> = [];
    let j = 0;
    let last: { day: string; position: number | null } | null = null;
    for (const day of dayList) {
      while (j < list.length && list[j].day <= day) last = list[j++];
      out.push(last && addDays(last.day, CARRY_DAYS) >= day ? last.position : undefined);
    }
    values.set(id, out);
  }
  return { days: dayList, values };
}

function seriesFrom(days: string[], values: Map<number, Array<number | null | undefined>>): SeriesPoint[] {
  return days.map((day, i) => {
    const known: Array<number | null> = [];
    for (const v of values.values()) if (v[i] !== undefined) known.push(v[i] as number | null);
    return {
      day,
      visibility: known.length ? visibilityScore(known) : null,
      averagePosition: averagePosition(known),
      top10: known.filter((p) => p !== null && p <= 10).length,
      known: known.length,
    };
  });
}

export interface RankSummary {
  /** All keywords of the project / active ones / checked at least once. */
  keywords: number;
  active: number;
  checked: number;
  ranked: number;
  top3: number;
  top10: number;
  top100: number;
  averagePosition: number | null;
  visibility: number;
  /** Values at the start of the period (null = no data then). */
  previous: { averagePosition: number | null; visibility: number | null };
  /** Keywords that moved up / down since the start of the period. */
  up: number;
  down: number;
  series: SeriesPoint[];
  lastCheckedAt: string | null;
}

/** KPIs and the visibility / average-position series of a project's active keywords. */
export async function getRankSummary(projectId: number, days: number): Promise<RankSummary> {
  const db = await getDb();
  const kws = await db.selectFrom("keywords").select(["id", "status", "last_position", "last_checked_at"]).where("project_id", "=", projectId).execute();
  const active = kws.filter((k) => k.status === "active");
  const checked = active.filter((k) => k.last_checked_at);
  const current = checked.map((k) => num(k.last_position));
  const ranked = current.filter((p): p is number => p !== null);
  const { days: dayList, values } = await dailyMatrix(
    active.map((k) => k.id),
    Math.max(2, days),
  );
  const series = seriesFrom(dayList, values);
  let up = 0;
  let down = 0;
  for (const k of checked) {
    const start = values.get(k.id)?.[0];
    if (start === undefined) continue;
    const change = positionChange(start, num(k.last_position));
    if (change.kind === "up" || change.kind === "new") up += 1;
    else if (change.kind === "down" || change.kind === "lost") down += 1;
  }
  const lastCheckedAt = checked.reduce<string | null>((m, k) => (k.last_checked_at && (!m || k.last_checked_at > m) ? k.last_checked_at : m), null);
  return {
    keywords: kws.length,
    active: active.length,
    checked: checked.length,
    ranked: ranked.length,
    top3: ranked.filter((p) => p <= 3).length,
    top10: ranked.filter((p) => p <= 10).length,
    top100: ranked.filter((p) => p <= 100).length,
    averagePosition: averagePosition(current),
    visibility: visibilityScore(current),
    previous: { averagePosition: series[0]?.averagePosition ?? null, visibility: series[0]?.visibility ?? null },
    up,
    down,
    series,
    lastCheckedAt,
  };
}

// ── Competitors ──

export interface DomainStats {
  domain: string;
  isProject: boolean;
  /** visibilityScore() over the tracked keywords (0–100). */
  visibility: number;
  /** Share of voice: the domain's expected clicks as a share of all tracked domains' (0–100). */
  share: number;
  averagePosition: number | null;
  ranked: number;
  top3: number;
  top10: number;
  /** Keywords where this domain ranks above the project (competitors only). */
  ahead: number;
}

export interface CompetitorOverview {
  /** Keywords with a check (latest row used). */
  keywords: number;
  domains: DomainStats[];
  /** Visibility per domain per day (null = no data). */
  series: Array<{ day: string; values: Record<string, number | null> }>;
}

/** Share of voice and positions of the project and its competitors, from the latest rankings of each active keyword. */
export async function getCompetitorOverview(project: { id: number; domain: string; competitors: string[] }, days: number): Promise<CompetitorOverview> {
  const db = await getDb();
  const active = await db.selectFrom("keywords").select(["id"]).where("project_id", "=", project.id).where("status", "=", "active").execute();
  const ids = active.map((k) => k.id);
  const dayList = periodDays(Math.max(2, days));
  const from = addDays(dayList[0], -CARRY_DAYS);
  // keyword → rows (day, own position, competitors)
  const rows = new Map<number, Array<{ day: string; own: number | null; comp: Record<string, number | null> }>>();
  for (let i = 0; i < ids.length; i += 500) {
    const part = await db
      .selectFrom("rankings")
      .select(["keyword_id", "day", "position", "competitors"])
      .where("keyword_id", "in", ids.slice(i, i + 500))
      .where("day", ">=", from)
      .orderBy("day")
      .execute();
    for (const r of part) {
      let list = rows.get(r.keyword_id);
      if (!list) rows.set(r.keyword_id, (list = []));
      list.push({ day: r.day, own: num(r.position), comp: competitorsOf(r.competitors) });
    }
  }
  const domains = [project.domain, ...project.competitors];
  const latest = [...rows.values()].map((list) => list[list.length - 1]).filter(Boolean);
  const posOf = (row: { own: number | null; comp: Record<string, number | null> }, domain: string) => (domain === project.domain ? row.own : (row.comp[domain] ?? null));
  const clicks = domains.map((d) => latest.reduce((sum, row) => sum + expectedCtr(posOf(row, d)), 0));
  const totalClicks = clicks.reduce((a, b) => a + b, 0);
  const stats: DomainStats[] = domains.map((domain, i) => {
    const positions = latest.map((row) => posOf(row, domain));
    const ranked = positions.filter((p): p is number => p !== null);
    return {
      domain,
      isProject: i === 0,
      visibility: visibilityScore(positions),
      share: totalClicks > 0 ? Math.round((clicks[i] / totalClicks) * 1000) / 10 : 0,
      averagePosition: averagePosition(positions),
      ranked: ranked.length,
      top3: ranked.filter((p) => p <= 3).length,
      top10: ranked.filter((p) => p <= 10).length,
      ahead:
        i === 0
          ? 0
          : latest.filter((row) => {
              const theirs = posOf(row, domain);
              return theirs !== null && (row.own === null || theirs < row.own);
            }).length,
    };
  });
  // Visibility per domain per day, carrying each keyword's last row forward.
  const cursors = [...rows.values()].map((list) => ({ list, j: 0, last: null as (typeof list)[number] | null }));
  const series = dayList.map((day) => {
    const known: Array<{ own: number | null; comp: Record<string, number | null> }> = [];
    for (const c of cursors) {
      while (c.j < c.list.length && c.list[c.j].day <= day) c.last = c.list[c.j++];
      if (c.last && addDays(c.last.day, CARRY_DAYS) >= day) known.push(c.last);
    }
    const values: Record<string, number | null> = {};
    for (const d of domains) values[d] = known.length ? visibilityScore(known.map((row) => posOf(row, d))) : null;
    return { day, values };
  });
  return { keywords: latest.length, domains: stats, series };
}

// ── Snapshots ──

export interface Snapshot {
  checkedAt: string;
  results: SerpResult[];
}

/** The latest SERP snapshot of a keyword (top 20), or null. */
export async function getLatestSnapshot(keywordId: number): Promise<Snapshot | null> {
  const db = await getDb();
  const row = await db.selectFrom("serp_snapshots").select(["checked_at", "results"]).where("keyword_id", "=", keywordId).orderBy("checked_at", "desc").limit(1).executeTakeFirst();
  if (!row) return null;
  const list = parseJson(row.results);
  const results: SerpResult[] = Array.isArray(list)
    ? list
        .filter((r): r is SerpResult => Boolean(r) && typeof r === "object" && typeof (r as SerpResult).url === "string")
        .map((r) => ({ position: Number(r.position) || 0, url: String(r.url), title: String(r.title ?? ""), domain: String(r.domain ?? "") }))
    : [];
  return { checkedAt: row.checked_at, results };
}
