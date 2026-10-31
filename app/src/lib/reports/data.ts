import "server-only";
import { getDb } from "@/lib/db";
import { getGscDaily, getGscTop, lastGscDay, sumDays, type GscDay, type GscTopRow, type GscTotals } from "@/lib/gsc/data";
import { getAuditDigest, getRankStats, type AuditDigest, type Mover, type VisibilityPoint } from "@/lib/overview";
import { periodDays } from "@/lib/periods";
import { getEntitlementsForUserId, type Entitlements } from "@/lib/plans";
import type { ProjectRecord } from "@/lib/projects";
import { getSettings, type Settings } from "@/lib/settings";
import { absoluteUrl, uploadUrl } from "@/lib/site";
import { averagePosition, positionChange, visibilityScore } from "@/seo/normalize";

/**
 * Everything a client report shows (public /r/<token> page, owner preview, report emails):
 * rankings, visibility, the latest audit and Search Console totals for a period, plus the
 * branding that applies. Custom logo / colour / company name need the owner's white-label plan;
 * "Powered by" is hidden for white-label (or remove-branding) plans and when the platform's
 * branding text is empty.
 */

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function reportPeriod(value: unknown): ReportPeriod {
  return REPORT_PERIODS.find((p) => String(p) === String(value)) ?? 30;
}

export interface ReportBrand {
  /** Shown as the report's author. */
  company: string;
  /** Absolute or site-relative image URL, or "". */
  logo: string;
  /** #rrggbb accent. */
  color: string;
  /** "Powered by …" text, or "" when hidden. */
  poweredBy: string;
  poweredByUrl: string;
  siteName: string;
}

export interface ReportKeywordRow {
  phrase: string;
  country: string;
  device: string;
  position: number | null;
  previous: number | null;
  change: ReturnType<typeof positionChange>;
  best: number | null;
  url: string | null;
}

export interface ReportData {
  project: { id: number; name: string; domain: string };
  brand: ReportBrand;
  days: ReportPeriod;
  from: string;
  to: string;
  rankings: {
    keywords: number;
    ranked: number;
    top3: number;
    top10: number;
    top100: number;
    visibility: number;
    visibilityStart: number;
    averagePosition: number | null;
    averageStart: number | null;
    up: number;
    down: number;
    series: VisibilityPoint[];
    rows: ReportKeywordRow[];
    movers: Mover[];
  };
  audit: AuditDigest | null;
  gsc: { property: string; demo: boolean; totals: GscTotals; previous: GscTotals; series: GscDay[]; topQueries: GscTopRow[]; from: string; to: string } | null;
  generatedAt: string;
}

const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function reportBrand(project: Pick<ProjectRecord, "name" | "settings">, ent: Pick<Entitlements, "allowWhiteLabel" | "removeBranding">, settings: Settings): ReportBrand {
  const custom = ent.allowWhiteLabel ? project.settings.report : { companyName: "", logo: "", color: "" };
  const hidePowered = ent.allowWhiteLabel || ent.removeBranding || !settings.branding_text.trim();
  return {
    company: custom.companyName || (ent.allowWhiteLabel ? project.name : settings.site_name),
    logo: custom.logo ? uploadUrl(custom.logo) : ent.allowWhiteLabel ? "" : uploadUrl(settings.logo),
    color: custom.color || (/^#[0-9a-f]{6}$/i.test(settings.primary_color) ? settings.primary_color : "#0e7490"),
    poweredBy: hidePowered ? "" : settings.branding_text.trim(),
    poweredByUrl: settings.branding_url || absoluteUrl(settings, "/"),
    siteName: settings.site_name,
  };
}

/** Rows of the keywords table: every keyword, by current position (not ranked last), at most `limit`. */
async function keywordRows(projectId: number, movers: Mover[], limit: number): Promise<ReportKeywordRow[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("keywords")
    .select(["id", "phrase", "country", "device", "last_position", "best_position", "last_url", "last_checked_at"])
    .where("project_id", "=", projectId)
    .where("status", "=", "active")
    .execute();
  const start = new Map(movers.map((m) => [m.keywordId, m.previous]));
  const list = rows.map((r) => {
    const position = r.last_position === null ? null : Number(r.last_position);
    const previous = start.has(r.id) ? (start.get(r.id) ?? null) : position;
    return {
      phrase: r.phrase,
      country: r.country,
      device: r.device,
      position,
      previous,
      change: r.last_checked_at ? positionChange(previous, position) : positionChange(null, null),
      best: r.best_position === null ? null : Number(r.best_position),
      url: r.last_url,
    };
  });
  const p = (v: number | null) => (v === null ? Number.MAX_SAFE_INTEGER : v);
  list.sort((a, b) => p(a.position) - p(b.position) || a.phrase.localeCompare(b.phrase));
  return list.slice(0, limit);
}

export async function buildReport(project: ProjectRecord, days: ReportPeriod, options: { keywordLimit?: number } = {}): Promise<ReportData> {
  const [settings, ent] = await Promise.all([getSettings(), getEntitlementsForUserId(project.userId)]);
  const dayList = periodDays(days);
  const db = await getDb();
  const [statsMap, audit, kwRows] = await Promise.all([
    getRankStats([project.id], dayList),
    getAuditDigest(project.id, 10),
    db.selectFrom("keywords").select(["status", "last_position", "last_checked_at"]).where("project_id", "=", project.id).execute(),
  ]);
  const stats = statsMap.get(project.id) ?? { series: [], up: 0, down: 0, movers: [], keywords: [] };
  const active = kwRows.filter((k) => k.status === "active");
  const positions = active.filter((k) => k.last_checked_at).map((k) => (k.last_position === null ? null : Number(k.last_position)));
  const ranked = positions.filter((p): p is number => p !== null);
  const firstKnown = stats.series.find((s) => s.tracked > 0);
  const startPositions = stats.keywords.map((k) => k.previous);

  let gsc: ReportData["gsc"] = null;
  if (project.gscProperty) {
    const last = (await lastGscDay(project.id)) ?? shift(dayList[dayList.length - 1], -2);
    const from = shift(last, -(days - 1));
    const [series, prev, topQueries] = await Promise.all([
      getGscDaily(project.id, from, last),
      getGscDaily(project.id, shift(from, -days), shift(from, -1)),
      getGscTop(project.id, "query", from, last, 10),
    ]);
    gsc = { property: project.gscProperty, demo: project.gscConnectionId === null, totals: sumDays(series), previous: sumDays(prev), series, topQueries, from, to: last };
  }

  return {
    project: { id: project.id, name: project.name, domain: project.domain },
    brand: reportBrand(project, ent, settings),
    days,
    from: dayList[0],
    to: dayList[dayList.length - 1],
    rankings: {
      keywords: active.length,
      ranked: ranked.length,
      top3: ranked.filter((p) => p <= 3).length,
      top10: ranked.filter((p) => p <= 10).length,
      top100: ranked.filter((p) => p <= 100).length,
      visibility: visibilityScore(positions),
      visibilityStart: firstKnown?.visibility ?? (startPositions.length ? visibilityScore(startPositions) : 0),
      averagePosition: averagePosition(positions),
      averageStart: firstKnown?.averagePosition ?? null,
      up: stats.up,
      down: stats.down,
      series: stats.series,
      rows: await keywordRows(project.id, stats.keywords, options.keywordLimit ?? 500),
      movers: stats.movers,
    },
    audit,
    gsc,
    generatedAt: new Date().toISOString(),
  };
}
