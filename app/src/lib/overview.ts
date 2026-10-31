import "server-only";
import { sql } from "kysely";
import { getDb } from "./db";
import { getGscDaily, sumDays, type GscDay, type GscTotals } from "./gsc/data";
import { readImportState } from "./gsc/import";
import { periodDays } from "./periods";
import type { ProjectRecord } from "./projects";
import { averagePosition, parseJson, positionChange, scoreGrade, visibilityScore, type PositionChange } from "@/seo/normalize";
import type { AuditStatus, AuditSummary, Severity } from "@/seo/types";

/**
 * Numbers for the projects grid, the project overview and the reports, read straight from the
 * documented tables (keywords, rankings, audits, audit_issues, gsc_daily, alert_log) so they
 * don't depend on the rank tracker's or the crawler's own helpers.
 *
 * Rank history: rankings has one row per keyword and checked day. Weekly checks leave gaps, so
 * a keyword's position on a day is its last known position up to that day (looking back at most
 * LOOKBACK_DAYS before the period). Keywords never checked by then are left out.
 */

const LOOKBACK_DAYS = 14;
const DAY_MS = 86_400_000;

export interface VisibilityPoint {
  day: string;
  visibility: number;
  averagePosition: number | null;
  /** Keywords with a known position that day (ranked or not). */
  tracked: number;
}

export interface Mover {
  keywordId: number;
  phrase: string;
  country: string;
  device: string;
  previous: number | null;
  current: number | null;
  change: PositionChange;
  url: string | null;
}

export interface RankStats {
  series: VisibilityPoint[];
  /** Keywords whose position improved / dropped between the first and the last day (new / lost count as up / down). */
  up: number;
  down: number;
  movers: Mover[];
  /** Every active keyword with a known position: at the start and at the end of the period. */
  keywords: Mover[];
}

const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Visibility series, ups / downs and movers of projects for the given days (oldest first). */
export async function getRankStats(projectIds: number[], days: string[]): Promise<Map<number, RankStats>> {
  const out = new Map<number, RankStats>();
  if (!projectIds.length || !days.length) return out;
  const db = await getDb();
  const keywords = await db
    .selectFrom("keywords")
    .select(["id", "project_id", "phrase", "country", "device", "last_url"])
    .where("project_id", "in", projectIds)
    .where("status", "=", "active")
    .execute();
  const from = shift(days[0], -LOOKBACK_DAYS);
  const to = days[days.length - 1];
  const rows = await db
    .selectFrom("rankings")
    .select(["keyword_id", "project_id", "day", "position", "url"])
    .where("project_id", "in", projectIds)
    .where("day", ">=", from)
    .where("day", "<=", to)
    .orderBy("day")
    .execute();
  const history = new Map<number, Array<{ day: string; position: number | null; url: string | null }>>();
  for (const r of rows) {
    const list = history.get(r.keyword_id) ?? [];
    list.push({ day: r.day, position: r.position === null ? null : Number(r.position), url: r.url });
    history.set(r.keyword_id, list);
  }
  const byProject = new Map<number, typeof keywords>();
  for (const k of keywords) {
    const list = byProject.get(k.project_id) ?? [];
    list.push(k);
    byProject.set(k.project_id, list);
  }
  for (const projectId of projectIds) {
    const list = byProject.get(projectId) ?? [];
    // Position of every keyword on every day (undefined = not known yet).
    const perDay: Array<Array<number | null>> = days.map(() => []);
    const movers: Mover[] = [];
    const all: Mover[] = [];
    let up = 0;
    let down = 0;
    for (const k of list) {
      const h = history.get(k.id) ?? [];
      let i = 0;
      let known: { position: number | null; url: string | null } | undefined;
      let first: number | null | undefined;
      days.forEach((day, d) => {
        while (i < h.length && h[i].day <= day) known = h[i++];
        if (known !== undefined) {
          perDay[d].push(known.position);
          if (first === undefined) first = known.position;
        }
      });
      if (known === undefined || first === undefined) continue;
      const change = positionChange(first, known.position);
      if (change.kind === "up" || change.kind === "new") up += 1;
      if (change.kind === "down" || change.kind === "lost") down += 1;
      const mover = { keywordId: k.id, phrase: k.phrase, country: k.country, device: k.device, previous: first, current: known.position, change, url: known.url ?? k.last_url };
      all.push(mover);
      if (change.kind !== "same" && change.kind !== "none") movers.push(mover);
    }
    out.set(projectId, {
      series: days.map((day, d) => ({ day, visibility: visibilityScore(perDay[d]), averagePosition: averagePosition(perDay[d]), tracked: perDay[d].length })),
      up,
      down,
      movers,
      keywords: all,
    });
  }
  return out;
}

/** Biggest gains and losses: the top `n` up (incl. new) and the top `n` down (incl. lost). */
export function topMovers(movers: Mover[], n = 5): { up: Mover[]; down: Mover[] } {
  const weight = (m: Mover) => (m.change.delta !== null ? Math.abs(m.change.delta) : 100 - Math.min(99, (m.current ?? m.previous ?? 100) - 1));
  const up = movers.filter((m) => m.change.kind === "up" || m.change.kind === "new").sort((a, b) => weight(b) - weight(a) || a.phrase.localeCompare(b.phrase));
  const down = movers.filter((m) => m.change.kind === "down" || m.change.kind === "lost").sort((a, b) => weight(b) - weight(a) || a.phrase.localeCompare(b.phrase));
  return { up: up.slice(0, n), down: down.slice(0, n) };
}

// ── Audits ──

export interface AuditIssueCount {
  code: string;
  severity: Severity;
  count: number;
}

export interface AuditDigest {
  id: number;
  status: AuditStatus;
  score: number | null;
  grade: ReturnType<typeof scoreGrade>;
  finishedAt: string | null;
  pagesCrawled: number;
  critical: number;
  warning: number;
  notice: number;
  previousScore: number | null;
  /** Issue occurrences that are new / gone since the previous finished audit (per code). */
  newIssues: number;
  fixedIssues: number;
  topIssues: AuditIssueCount[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, notice: 2 };

async function issueCounts(auditId: number): Promise<AuditIssueCount[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("audit_issues")
    .select(["code", "severity", (eb) => eb.fn.countAll<number>().as("n")])
    .where("audit_id", "=", auditId)
    .groupBy(["code", "severity"])
    .execute();
  return rows
    .map((r) => ({ code: r.code, severity: (["critical", "warning", "notice"].includes(r.severity) ? r.severity : "notice") as Severity, count: Number(r.n ?? 0) }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count || a.code.localeCompare(b.code));
}

/** The latest finished audit of a project with its issue counts and the change since the one before. */
export async function getAuditDigest(projectId: number, topN = 8): Promise<AuditDigest | null> {
  const db = await getDb();
  const done = await db
    .selectFrom("audits")
    .select(["id", "status", "score", "finished_at", "pages_crawled", "issues_summary"])
    .where("project_id", "=", projectId)
    .where("status", "=", "done")
    .orderBy("id", "desc")
    .limit(2)
    .execute();
  const latest = done[0];
  if (!latest) return null;
  const counts = await issueCounts(latest.id);
  const summary = parseJson(latest.issues_summary) as Partial<AuditSummary>;
  const bySeverity = (s: Severity) => (typeof summary[s] === "number" ? Number(summary[s]) : counts.filter((c) => c.severity === s).reduce((a, c) => a + c.count, 0));
  let newIssues = 0;
  let fixedIssues = 0;
  const previous = done[1];
  // The crawler stores the change since the previous audit (per code and page) in issues_summary.diff.
  const diff = (summary as { diff?: { newIssues?: unknown; fixedIssues?: unknown; previousScore?: unknown } }).diff;
  if (diff && typeof diff.newIssues === "number" && typeof diff.fixedIssues === "number") {
    newIssues = diff.newIssues;
    fixedIssues = diff.fixedIssues;
  } else if (previous) {
    const before = new Map((await issueCounts(previous.id)).map((c) => [c.code, c.count]));
    const now = new Map(counts.map((c) => [c.code, c.count]));
    for (const [code, n] of now) newIssues += Math.max(0, n - (before.get(code) ?? 0));
    for (const [code, n] of before) fixedIssues += Math.max(0, n - (now.get(code) ?? 0));
  }
  const score = latest.score === null ? null : Number(latest.score);
  return {
    id: latest.id,
    status: "done",
    score,
    grade: scoreGrade(score),
    finishedAt: latest.finished_at,
    pagesCrawled: Number(latest.pages_crawled ?? 0),
    critical: bySeverity("critical"),
    warning: bySeverity("warning"),
    notice: bySeverity("notice"),
    previousScore: previous?.score === null || previous?.score === undefined ? null : Number(previous.score),
    newIssues,
    fixedIssues,
    topIssues: counts.slice(0, topN),
  };
}

/** An audit that is queued or running, if any. */
export async function getRunningAudit(projectId: number): Promise<{ id: number; status: AuditStatus; pagesCrawled: number; pagesLimit: number } | null> {
  const db = await getDb();
  const row = await db
    .selectFrom("audits")
    .select(["id", "status", "pages_crawled", "pages_limit"])
    .where("project_id", "=", projectId)
    .where("status", "in", ["queued", "crawling", "analyzing"])
    .orderBy("id", "desc")
    .executeTakeFirst();
  return row ? { id: row.id, status: row.status, pagesCrawled: Number(row.pages_crawled ?? 0), pagesLimit: Number(row.pages_limit ?? 0) } : null;
}

// ── Alerts ──

export interface RecentAlert {
  id: number;
  event: string;
  ok: boolean;
  error: string | null;
  channel: string | null;
  createdAt: string;
}

export async function getRecentAlerts(projectId: number, limit = 8): Promise<RecentAlert[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("alert_log")
    .leftJoin("alert_channels", "alert_channels.id", "alert_log.channel_id")
    .select(["alert_log.id", "alert_log.event", "alert_log.ok", "alert_log.error", "alert_log.created_at", "alert_channels.name as channel"])
    .where("alert_log.project_id", "=", projectId)
    .orderBy("alert_log.id", "desc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({ id: r.id, event: r.event, ok: r.ok === 1, error: r.error, channel: r.channel ?? null, createdAt: r.created_at }));
}

// ── Project overview ──

export interface ProjectOverview {
  days: string[];
  keywords: { total: number; active: number; ranked: number; top3: number; top10: number };
  visibility: { now: number; previous: number };
  averagePosition: { now: number | null; previous: number | null };
  rank: RankStats;
  audit: AuditDigest | null;
  runningAudit: Awaited<ReturnType<typeof getRunningAudit>>;
  gsc: { property: string; demo: boolean; series: GscDay[]; totals: GscTotals; previous: GscTotals; lastImportAt: string | null } | null;
  alerts: RecentAlert[];
}

export async function getProjectOverview(project: Pick<ProjectRecord, "id" | "gscProperty" | "gscConnectionId">, periodLength = 30): Promise<ProjectOverview> {
  const days = periodDays(periodLength);
  const db = await getDb();
  const [rankMap, audit, runningAudit, alerts, keywordRows] = await Promise.all([
    getRankStats([project.id], days),
    getAuditDigest(project.id),
    getRunningAudit(project.id),
    getRecentAlerts(project.id),
    db.selectFrom("keywords").select(["status", "last_position", "last_checked_at"]).where("project_id", "=", project.id).execute(),
  ]);
  const rank = rankMap.get(project.id) ?? { series: [], up: 0, down: 0, movers: [], keywords: [] };
  const active = keywordRows.filter((k) => k.status === "active");
  const positions = active.filter((k) => k.last_checked_at).map((k) => (k.last_position === null ? null : Number(k.last_position)));
  const ranked = positions.filter((p): p is number => p !== null);
  const firstKnown = rank.series.find((p) => p.tracked > 0);
  let gsc: ProjectOverview["gsc"] = null;
  if (project.gscProperty) {
    // Search Console lags ~2 days: compare the last `periodLength` days that can have data.
    const end = shift(days[days.length - 1], -2);
    const from = shift(end, -(periodLength - 1));
    const [series, prevSeries, state] = await Promise.all([
      getGscDaily(project.id, from, end),
      getGscDaily(project.id, shift(from, -periodLength), shift(from, -1)),
      readImportState(project.id),
    ]);
    gsc = { property: project.gscProperty, demo: project.gscConnectionId === null, series, totals: sumDays(series), previous: sumDays(prevSeries), lastImportAt: state?.lastImportAt ?? null };
  }
  return {
    days,
    keywords: { total: keywordRows.length, active: active.length, ranked: ranked.length, top3: ranked.filter((p) => p <= 3).length, top10: ranked.filter((p) => p <= 10).length },
    visibility: { now: visibilityScore(positions), previous: firstKnown?.visibility ?? 0 },
    averagePosition: { now: averagePosition(positions), previous: firstKnown?.averagePosition ?? null },
    rank,
    audit,
    runningAudit,
    gsc,
    alerts,
  };
}

// ── Projects grid ──

export interface ProjectCard {
  /** Visibility per day of the last 30 days (sparkline). */
  spark: number[];
  visibility: number;
  averagePosition: number | null;
  keywords: number;
  up: number;
  down: number;
  score: number | null;
  /** Most recent rank check, audit or Search Console import. */
  lastActivity: string | null;
}

export async function getProjectCards(projects: Array<Pick<ProjectRecord, "id">>): Promise<Map<number, ProjectCard>> {
  const out = new Map<number, ProjectCard>();
  const ids = projects.map((p) => p.id);
  if (!ids.length) return out;
  const db = await getDb();
  const days = periodDays(30);
  const week = days.slice(-8);
  const [stats, weekStats, keywordRows, audits, states] = await Promise.all([
    getRankStats(ids, days),
    getRankStats(ids, week),
    db.selectFrom("keywords").select(["project_id", "status", "last_position", "last_checked_at"]).where("project_id", "in", ids).execute(),
    db
      .selectFrom("audits")
      .select(["project_id", "status", "score", sql<string>`coalesce(finished_at, started_at, created_at)`.as("at")])
      .where("project_id", "in", ids)
      .orderBy("id", "desc")
      .execute(),
    Promise.all(ids.map((id) => readImportState(id))),
  ]);
  for (const [i, id] of ids.entries()) {
    const kws = keywordRows.filter((k) => k.project_id === id);
    const positions = kws.filter((k) => k.status === "active" && k.last_checked_at).map((k) => (k.last_position === null ? null : Number(k.last_position)));
    const lastCheck = kws.reduce<string | null>((m, k) => (k.last_checked_at && (!m || k.last_checked_at > m) ? k.last_checked_at : m), null);
    const projectAudits = audits.filter((a) => a.project_id === id);
    const lastDone = projectAudits.find((a) => a.status === "done");
    const candidates = [lastCheck, projectAudits[0]?.at ?? null, states[i]?.lastImportAt ?? null].filter((v): v is string => Boolean(v));
    const s = stats.get(id);
    const w = weekStats.get(id);
    out.set(id, {
      spark: (s?.series ?? []).map((p) => p.visibility),
      visibility: visibilityScore(positions),
      averagePosition: averagePosition(positions),
      keywords: kws.length,
      up: w?.up ?? 0,
      down: w?.down ?? 0,
      score: lastDone?.score === null || lastDone?.score === undefined ? null : Number(lastDone.score),
      lastActivity: candidates.sort().at(-1) ?? null,
    });
  }
  return out;
}
