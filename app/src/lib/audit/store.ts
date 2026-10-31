import "server-only";
import type { Kysely } from "kysely";
import { now } from "@/lib/db";
import type { AuditPage, Database } from "@/lib/db/schema";
import { int, parseJson, str } from "@/seo/normalize";
import type { AuditSummary, CrawlSettings, UserAgentMode } from "@/seo/types";
import type { AuditSettingsJson, CrawledPage, SiteFacts } from "./types";
import { urlHash } from "./url";

/** Database helpers of the site audit: settings JSON, the crawl frontier and page rows. */

export const ACTIVE_STATUSES = ["queued", "crawling", "analyzing"] as const;
export const FINAL_STATUSES = ["done", "failed", "cancelled"] as const;
export const DEFAULT_MAX_DEPTH = 10;
/** Queue depth of sitemap URLs not reached through links yet (crawled after linked pages). */
export const SITEMAP_DEPTH = 1000;

const EMPTY_SUMMARY: AuditSummary = { critical: 0, warning: 0, notice: 0, byCode: {}, pagesWithCritical: 0, pagesWithIssues: 0 };

export function emptySummaryJson(): string {
  return JSON.stringify(EMPTY_SUMMARY);
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
}

/** audits.settings → crawl settings + site facts (tolerates missing / old keys). */
export function readAuditSettings(text: string): AuditSettingsJson {
  const o = parseJson(text) as Record<string, unknown>;
  const ua: UserAgentMode = o.userAgent === "browser" ? "browser" : "bot";
  const settings: AuditSettingsJson = {
    startUrl: str(o.startUrl, "", 1000),
    pageLimit: int(o.pageLimit, 100, 1, 1_000_000),
    maxDepth: int(o.maxDepth, DEFAULT_MAX_DEPTH, 0, 100),
    crawlDelayMs: int(o.crawlDelayMs, 0, 0, 10_000),
    includePatterns: strList(o.includePatterns),
    excludePatterns: strList(o.excludePatterns),
    userAgent: ua,
  };
  if (o.site && typeof o.site === "object") settings.site = o.site as SiteFacts;
  return settings;
}

export function writeAuditSettings(settings: CrawlSettings & { site?: SiteFacts }): string {
  return JSON.stringify(settings);
}

/** audits.issues_summary → AuditSummary (plus the diff stored with it). */
export function readSummary(text: string | null | undefined): AuditSummary & { diff?: AuditDiff } {
  const o = parseJson(text) as Partial<AuditSummary> & { diff?: AuditDiff };
  return {
    critical: Number(o.critical) || 0,
    warning: Number(o.warning) || 0,
    notice: Number(o.notice) || 0,
    byCode: o.byCode && typeof o.byCode === "object" ? o.byCode : {},
    pagesWithCritical: Number(o.pagesWithCritical) || 0,
    pagesWithIssues: Number(o.pagesWithIssues) || 0,
    ...(o.diff && typeof o.diff === "object" ? { diff: o.diff } : {}),
  };
}

/** Change against the previous finished audit of the project (stored in issues_summary.diff). */
export interface AuditDiff {
  previousAuditId: number;
  previousScore: number | null;
  /** Issue occurrences (code + page) that are new / gone. */
  newIssues: number;
  fixedIssues: number;
  newByCode: Record<string, number>;
  fixedByCode: Record<string, number>;
}

// ── Crawl frontier ──

export interface QueueItem {
  url: string;
  depth: number;
  foundOn: string | null;
}

/** Add URLs to the frontier; URLs already known for the audit are ignored. Returns how many were added. */
export async function enqueue(db: Kysely<Database>, auditId: number, items: QueueItem[]): Promise<number> {
  const byHash = new Map<string, QueueItem & { hash: string }>();
  for (const item of items) {
    const hash = urlHash(item.url);
    if (!byHash.has(hash)) byHash.set(hash, { ...item, hash });
  }
  if (!byHash.size) return 0;
  const hashes = [...byHash.keys()];
  const lower = new Map<number, string[]>();
  for (let i = 0; i < hashes.length; i += 200) {
    const known = await db
      .selectFrom("audit_queue")
      .select(["url_hash", "depth", "state"])
      .where("audit_id", "=", auditId)
      .where("url_hash", "in", hashes.slice(i, i + 200))
      .execute();
    for (const k of known) {
      const item = byHash.get(k.url_hash)!;
      // Found again through a shorter path while still waiting: crawl it at the shorter depth.
      if (k.state === "pending" && item.depth >= 0 && Number(k.depth) > item.depth) lower.set(item.depth, [...(lower.get(item.depth) ?? []), k.url_hash]);
      byHash.delete(k.url_hash);
    }
  }
  for (const [depth, list] of lower) {
    await db.updateTable("audit_queue").set({ depth }).where("audit_id", "=", auditId).where("url_hash", "in", list).where("state", "=", "pending").execute();
  }
  const fresh = [...byHash.values()];
  if (!fresh.length) return 0;
  const ts = now();
  const rows = fresh.map((f) => ({
    audit_id: auditId,
    url: f.url,
    url_hash: f.hash,
    depth: f.depth,
    found_on: f.foundOn ? f.foundOn.slice(0, 1000) : null,
    state: "pending" as const,
    attempts: 0,
    status_code: null,
    created_at: ts,
  }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const part = rows.slice(i, i + 100);
    try {
      await db.insertInto("audit_queue").values(part).execute();
      added += part.length;
    } catch {
      // A row was added in the meantime (unique audit_id + url_hash): insert one by one.
      for (const row of part) {
        try {
          await db.insertInto("audit_queue").values(row).execute();
          added++;
        } catch {
          // already queued
        }
      }
    }
  }
  return added;
}

export async function countPages(db: Kysely<Database>, auditId: number): Promise<number> {
  const row = await db.selectFrom("audit_pages").select((eb) => eb.fn.countAll<number>().as("n")).where("audit_id", "=", auditId).executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Pending page URLs and external link checks of an audit. */
export async function queueCounts(db: Kysely<Database>, auditId: number): Promise<{ pending: number; total: number; external: number }> {
  const rows = await db
    .selectFrom("audit_queue")
    .select(["state", (eb) => eb.fn.countAll<number>().as("n")])
    .where("audit_id", "=", auditId)
    .where("depth", ">=", 0)
    .groupBy("state")
    .execute();
  const ext = await db.selectFrom("audit_queue").select((eb) => eb.fn.countAll<number>().as("n")).where("audit_id", "=", auditId).where("depth", "<", 0).executeTakeFirst();
  let pending = 0;
  let total = 0;
  for (const r of rows) {
    total += Number(r.n);
    if (r.state === "pending") pending += Number(r.n);
  }
  return { pending, total, external: Number(ext?.n ?? 0) };
}

// ── Pages ──

/** audit_pages.data must fit a MySQL TEXT column (64 KB): long lists are trimmed until it does. */
const MAX_DATA_BYTES = 60_000;

export function serializePage(page: CrawledPage): string {
  let data: CrawledPage = page;
  let json = JSON.stringify(data);
  const steps: Array<(p: CrawledPage) => CrawledPage> = [
    (p) => ({ ...p, images: p.images.slice(0, 10) }),
    (p) => ({ ...p, externalLinks: p.externalLinks.slice(0, 40), mixedContent: p.mixedContent.slice(0, 20) }),
    (p) => ({ ...p, internalLinks: p.internalLinks.slice(0, 200), hreflang: p.hreflang.slice(0, 40) }),
    (p) => ({ ...p, internalLinks: p.internalLinks.slice(0, 100), externalLinks: p.externalLinks.slice(0, 10), images: [] }),
    (p) => ({ ...p, internalLinks: p.internalLinks.slice(0, 40), openGraph: {}, twitterCard: {}, jsonLd: p.jsonLd.slice(0, 3) }),
  ];
  for (const step of steps) {
    if (Buffer.byteLength(json) <= MAX_DATA_BYTES) break;
    data = step(data);
    json = JSON.stringify(data);
  }
  return json;
}

/** A stored page as the checks and the UI see it: the data JSON with the analysed columns on top. */
export function toCrawledPage(row: Pick<AuditPage, "url" | "status_code" | "depth" | "inlinks" | "data">): CrawledPage {
  const d = parseJson(row.data) as Partial<CrawledPage>;
  const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  return {
    url: row.url,
    finalUrl: d.finalUrl ?? row.url,
    statusCode: row.status_code === null ? null : Number(row.status_code),
    redirects: list(d.redirects),
    depth: Number(row.depth),
    contentType: d.contentType ?? "",
    sizeBytes: Number(d.sizeBytes) || 0,
    ttfbMs: Number(d.ttfbMs) || 0,
    loadMs: Number(d.loadMs) || 0,
    encoding: d.encoding ?? "",
    xRobotsTag: d.xRobotsTag ?? "",
    isHtml: Boolean(d.isHtml),
    title: d.title ?? null,
    metaDescription: d.metaDescription ?? null,
    h1: list(d.h1),
    canonical: d.canonical ?? null,
    robotsMeta: d.robotsMeta ?? "",
    lang: d.lang ?? "",
    viewport: Boolean(d.viewport),
    wordCount: Number(d.wordCount) || 0,
    internalLinks: list(d.internalLinks),
    externalLinks: list(d.externalLinks),
    imagesWithoutAlt: Number(d.imagesWithoutAlt) || 0,
    imagesTotal: Number(d.imagesTotal) || 0,
    mixedContent: list(d.mixedContent),
    hreflang: list(d.hreflang),
    openGraph: d.openGraph && typeof d.openGraph === "object" ? d.openGraph : {},
    twitterCard: d.twitterCard && typeof d.twitterCard === "object" ? d.twitterCard : {},
    jsonLd: list(d.jsonLd),
    favicon: Boolean(d.favicon),
    inlinks: Number(row.inlinks) || 0,
    error: d.error ?? null,
    finalStatus: d.finalStatus === undefined ? (row.status_code === null ? null : Number(row.status_code)) : d.finalStatus,
    redirectLoop: Boolean(d.redirectLoop),
    headings: Array.isArray(d.headings) && d.headings.length === 6 ? (d.headings as CrawledPage["headings"]) : [0, 0, 0, 0, 0, 0],
    scripts: Number(d.scripts) || 0,
    styles: Number(d.styles) || 0,
    nofollowLinks: Number(d.nofollowLinks) || 0,
    linksTotal: Number(d.linksTotal) || 0,
    imagesWithoutSize: Number(d.imagesWithoutSize) || 0,
    images: list(d.images),
    canonicalCount: Number(d.canonicalCount) || 0,
    charset: d.charset ?? "",
    inSitemap: Boolean(d.inSitemap),
  };
}
