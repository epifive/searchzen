import "server-only";
import type { Kysely } from "kysely";
import { getDb, now } from "@/lib/db";
import type { Audit, Database } from "@/lib/db/schema";
import { getProject, type ProjectRecord } from "@/lib/projects";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { incrementUsage } from "@/lib/usage";
import { hostMatches, pathMatches } from "@/seo/normalize";
import { analyzeAudit, failAudit } from "./analyze";
import { bodyText, crawlerUserAgent, fetchFollow, fetchOnce, isHtmlType, MAX_HTML_BYTES } from "./fetch";
import { parseHtml } from "./parse";
import { parseRobots, robotsLooksValid, robotsMatcher, ROBOTS_AGENT, type RobotsMatcher } from "./robots";
import { readSitemaps } from "./sitemap";
import { ACTIVE_STATUSES, countPages, enqueue, readAuditSettings, serializePage, SITEMAP_DEPTH, writeAuditSettings, type QueueItem } from "./store";
import type { AuditSettingsJson, CrawledPage, SiteFacts, TickResult } from "./types";
import { isSameSite, normalizeUrl, pathOf } from "./url";

/**
 * The resumable crawler. An audit's frontier lives in audit_queue, so the crawl runs in short
 * slices ("ticks") from the scheduler (cron URL, worker, lazy tick) or from the audit page
 * itself while someone watches it. A tick leases the audit (audits.locked_until) so two ticks
 * never crawl the same audit at once; a tick that dies leaves an expired lease that the next
 * tick takes over (pages already stored are never fetched twice: audit_pages is unique per URL).
 *
 *   queued ──init──▶ crawling ──frontier empty / page cap──▶ analyzing ──▶ done
 *                       └── cancel ──▶ cancelled        (unreachable site ──▶ failed)
 */

/** A tick's lease; renewed before every batch. */
export const LEASE_MS = 90_000;
/** Pages fetched in parallel (1 when a crawl delay applies). */
const CONCURRENCY = 3;
/** External links HEAD-checked per audit (a sample: the first ones found). */
export const EXTERNAL_SAMPLE = 50;
const EXTERNAL_BATCH = 6;
/** Audits running longer than this are stopped (stuck site, lost scheduler). */
const MAX_AUDIT_AGE_MS = 24 * 60 * 60_000;

const SKIP_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|map|woff2?|ttf|otf|eot|mp4|m4v|webm|mov|avi|mp3|wav|ogg|flac|zip|rar|7z|gz|tgz|bz2|dmg|exe|msi|apk|iso)$/i;

const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Lease ──

async function acquire(db: Kysely<Database>, auditId: number, leaseMs: number): Promise<string | null> {
  const token = iso(Date.now() + leaseMs);
  const res = await db
    .updateTable("audits")
    .set({ locked_until: token })
    .where("id", "=", auditId)
    .where("status", "in", [...ACTIVE_STATUSES])
    .where((eb) => eb.or([eb("locked_until", "is", null), eb("locked_until", "<", iso(Date.now()))]))
    .executeTakeFirst();
  return Number(res.numUpdatedRows) === 1 ? token : null;
}

/** Extend the lease; null when the audit was cancelled or another tick took over. */
async function renew(db: Kysely<Database>, auditId: number, token: string, leaseMs: number): Promise<string | null> {
  let next = iso(Date.now() + leaseMs);
  if (next === token) next = iso(Date.now() + leaseMs + 1);
  const res = await db
    .updateTable("audits")
    .set({ locked_until: next, updated_at: now() })
    .where("id", "=", auditId)
    .where("locked_until", "=", token)
    .where("status", "in", [...ACTIVE_STATUSES])
    .executeTakeFirst();
  return Number(res.numUpdatedRows) === 1 ? next : null;
}

async function release(db: Kysely<Database>, auditId: number, token: string): Promise<void> {
  await db.updateTable("audits").set({ locked_until: null }).where("id", "=", auditId).where("locked_until", "=", token).execute();
}

// ── Crawl rules ──

interface Rules {
  settings: AuditSettingsJson;
  facts: SiteFacts;
  robots: RobotsMatcher;
  userAgent: string;
  delayMs: number;
}

/** May the crawler queue this URL (same site, patterns, robots.txt, file type)? */
function crawlable(url: string, rules: Rules): boolean {
  if (!isSameSite(url, rules.facts.host)) return false;
  const path = pathOf(url);
  if (SKIP_EXTENSIONS.test(new URL(url).pathname)) return false;
  if (rules.settings.excludePatterns.some((p) => pathMatches(path, p))) return false;
  if (rules.settings.includePatterns.length && !rules.settings.includePatterns.some((p) => pathMatches(path, p))) return false;
  return rules.robots.allowed(path);
}

async function siteUrl(): Promise<string> {
  return absoluteUrl(await getSettings(), "/");
}

function rulesFor(settings: AuditSettingsJson, userAgent: string): Rules {
  const facts = settings.site!;
  const robots = robotsMatcher(parseRobots(facts.robotsText ?? ""), ROBOTS_AGENT);
  const delayMs = Math.min(10_000, Math.max(settings.crawlDelayMs, facts.robotsDelayMs ?? 0));
  return { settings, facts, robots, userAgent, delayMs };
}

// ── Init: homepage, robots.txt, sitemaps, HTTPS ──

async function initAudit(db: Kysely<Database>, audit: Audit, project: ProjectRecord, settings: AuditSettingsJson): Promise<boolean> {
  const userAgent = crawlerUserAgent(settings.userAgent, await siteUrl());
  // The start page: https first, then http; www / non-www redirects decide the crawled host.
  let start = settings.startUrl || `https://${project.domain}/`;
  let home = await fetchFollow(start, { userAgent, readBody: () => false, maxRedirects: 10 });
  if (home.final.status === null && !home.loop && start.startsWith("https:")) {
    const plain = start.replace(/^https:/, "http:");
    const second = await fetchFollow(plain, { userAgent, readBody: () => false, maxRedirects: 10 });
    if (second.final.status !== null) {
      home = second;
      start = plain;
    }
  }
  if (home.final.status === null || home.loop) {
    await failAudit(audit.id, home.loop ? `The start page ${start} redirects in a loop.` : `Could not reach ${start}: ${home.final.error ?? "no answer"}`);
    return false;
  }
  const finalUrl = normalizeUrl(home.final.url) ?? start;
  const final = new URL(finalUrl);
  if (!hostMatches(final.hostname, project.domain)) {
    await failAudit(audit.id, `The start page redirects to another site (${final.hostname}).`);
    return false;
  }
  const origin = final.origin;

  // robots.txt (rules for SearchzenBot, else *). A network error = unknown, not "missing".
  const robotsRes = await fetchFollow(`${origin}/robots.txt`, { userAgent, maxBytes: 512 * 1024, accept: "text/plain,*/*;q=0.5", maxRedirects: 5 });
  let robotsTxt: SiteFacts["robotsTxt"] = null;
  let robotsText = "";
  let robotsDelayMs = 0;
  if (robotsRes.final.status !== null && !robotsRes.loop) {
    const found = robotsRes.final.status === 200;
    const text = found ? bodyText(robotsRes.final) : "";
    const parsed = parseRobots(text);
    const valid = found && robotsLooksValid(text, robotsRes.final.headers["content-type"] ?? "", parsed);
    const matcher = robotsMatcher(valid ? parsed : parseRobots(""), ROBOTS_AGENT);
    robotsTxt = { found, valid, disallowAll: valid && matcher.disallowAll, sitemaps: valid ? parsed.sitemaps : [] };
    if (valid) {
      robotsText = text.slice(0, 64 * 1024);
      robotsDelayMs = Math.round(Math.min(10, matcher.crawlDelay) * 1000);
    }
  }

  // http:// → https:// redirect.
  let httpRedirectsToHttps: boolean | null = null;
  if (final.protocol === "https:") {
    const plain = await fetchOnce(`http://${final.host}/`, { userAgent, readBody: () => false });
    if (plain.status !== null) {
      const location = plain.headers.location ? new URL(plain.headers.location, `http://${final.host}/`) : null;
      httpRedirectsToHttps = plain.status >= 300 && plain.status < 400 && location ? location.protocol === "https:" : plain.status >= 200 && plain.status < 300 ? false : null;
    }
  }

  const favicon = await fetchFollow(`${origin}/favicon.ico`, { userAgent, readBody: () => false, maxRedirects: 3 });
  const faviconIco = favicon.final.status === null ? null : favicon.final.status === 200;

  // Sitemaps from robots.txt, else /sitemap.xml and /sitemap_index.xml.
  const listed = robotsTxt?.sitemaps ?? [];
  const sitemaps = await readSitemaps(listed, {
    userAgent,
    deadline: Date.now() + 25_000,
    maxUrls: settings.pageLimit,
    fallbacks: listed.length ? [] : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`],
  });

  const facts: SiteFacts = {
    origin,
    host: final.hostname,
    https: final.protocol === "https:",
    robotsTxt,
    robotsText,
    robotsDelayMs,
    sitemap: { found: sitemaps.found, valid: sitemaps.valid, urls: sitemaps.total },
    httpRedirectsToHttps,
    faviconIco,
    startRedirectedTo: finalUrl !== start ? finalUrl : null,
  };
  const next: AuditSettingsJson = { ...settings, startUrl: start, site: facts };
  const rules = rulesFor(next, userAgent);
  if (robotsTxt?.disallowAll || !rules.robots.allowed(pathOf(finalUrl))) {
    await db.updateTable("audits").set({ settings: writeAuditSettings(next) }).where("id", "=", audit.id).execute();
    await failAudit(audit.id, "robots.txt does not allow SearchzenBot to crawl the start page.");
    return false;
  }
  await enqueue(db, audit.id, [{ url: finalUrl, depth: 0, foundOn: null }]);
  // Sitemap URLs have no "found on" page (that is how the analysis recognises them) and a
  // placeholder depth, so pages found through links are crawled first; a link to a seed
  // lowers its depth to the real click depth.
  const seeds: QueueItem[] = sitemaps.urls.filter((u) => u !== finalUrl && crawlable(u, rules)).map((url) => ({ url, depth: SITEMAP_DEPTH, foundOn: null }));
  await enqueue(db, audit.id, seeds);
  await db
    .updateTable("audits")
    .set({ status: "crawling", settings: writeAuditSettings(next), started_at: audit.started_at ?? now(), updated_at: now() })
    .where("id", "=", audit.id)
    .where("status", "=", "queued")
    .execute();
  return true;
}

// ── Fetching one page ──

interface CrawlRow {
  id: number;
  url: string;
  url_hash: string;
  depth: number;
  found_on: string | null;
}

async function crawlPage(queued: CrawlRow, rules: Rules): Promise<{ page: CrawledPage; links: QueueItem[]; external: string[] }> {
  // A sitemap URL nobody linked to (yet) counts as one click from the start page.
  const row = { ...queued, depth: queued.depth >= SITEMAP_DEPTH ? 1 : queued.depth };
  const res = await fetchFollow(row.url, {
    userAgent: rules.userAgent,
    maxBytes: MAX_HTML_BYTES,
    maxRedirects: 10,
    firstHopBodyOnly: true,
    readBody: (status, type) => status === 200 && (!type || isHtmlType(type)),
  });
  const { final, hops } = res;
  const redirected = hops.length > 0;
  const contentType = (final.headers["content-type"] ?? "").slice(0, 100);
  const text = !redirected && final.body ? bodyText(final) : "";
  const sniffHtml = !contentType && /^\s*(<!doctype html|<html|<head|<body)/i.test(text.slice(0, 500));
  const isHtml = !redirected && final.status !== null && (isHtmlType(contentType) || sniffHtml);
  const finalUrl = res.loop ? final.url : (normalizeUrl(final.url) ?? final.url);
  const statusCode = redirected ? hops[0].status : final.status;
  const parsed = isHtml && final.status === 200 && text ? parseHtml(text, finalUrl, rules.facts.host) : null;
  const xRobotsTag = redirected ? "" : (final.headers["x-robots-tag"] ?? "").toLowerCase().slice(0, 250);

  const page: CrawledPage = {
    url: row.url,
    finalUrl,
    statusCode,
    redirects: hops,
    depth: row.depth,
    contentType,
    sizeBytes: redirected ? 0 : final.bytes,
    ttfbMs: res.firstTtfbMs,
    loadMs: res.totalMs,
    encoding: redirected ? "" : (final.headers["content-encoding"] ?? "").slice(0, 40),
    xRobotsTag,
    isHtml,
    title: parsed?.title ?? null,
    metaDescription: parsed?.metaDescription ?? null,
    h1: parsed?.h1.slice(0, 5) ?? [],
    canonical: parsed?.canonical ?? null,
    robotsMeta: parsed?.robotsMeta ?? "",
    lang: parsed?.lang ?? "",
    viewport: parsed?.viewport ?? false,
    wordCount: parsed?.wordCount ?? 0,
    internalLinks: parsed?.internalLinks ?? [],
    externalLinks: parsed?.externalLinks ?? [],
    imagesWithoutAlt: parsed?.imagesWithoutAlt ?? 0,
    imagesTotal: parsed?.imagesTotal ?? 0,
    mixedContent: parsed?.mixedContent ?? [],
    hreflang: parsed?.hreflang ?? [],
    openGraph: parsed?.openGraph ?? {},
    twitterCard: parsed?.twitterCard ?? {},
    jsonLd: parsed?.jsonLd ?? [],
    favicon: parsed?.favicon ?? false,
    inlinks: 0,
    error: res.loop ? "Redirect loop." : res.tooMany ? "Too many redirects." : final.status === null ? final.error : final.truncated ? `Only the first ${Math.round(MAX_HTML_BYTES / 1048576)} MB were read.` : null,
    finalStatus: res.loop ? null : final.status,
    redirectLoop: res.loop,
    headings: parsed?.headings ?? [0, 0, 0, 0, 0, 0],
    scripts: parsed?.scripts ?? 0,
    styles: parsed?.styles ?? 0,
    nofollowLinks: parsed?.nofollowLinks ?? 0,
    linksTotal: parsed?.linksTotal ?? 0,
    imagesWithoutSize: parsed?.imagesWithoutSize ?? 0,
    images: parsed?.images ?? [],
    canonicalCount: parsed?.canonicalCount ?? 0,
    charset: parsed?.charset ?? "",
    inSitemap: queued.found_on === null && queued.depth >= 1,
  };

  const links: QueueItem[] = [];
  const nextDepth = row.depth + 1;
  // A redirect target is crawled at the same depth (a redirect is not a click).
  if (redirected && !res.loop && finalUrl !== row.url && crawlable(finalUrl, rules)) links.push({ url: finalUrl, depth: row.depth, foundOn: row.url });
  if (parsed && nextDepth <= rules.settings.maxDepth) {
    for (const link of parsed.internalLinks) if (crawlable(link, rules)) links.push({ url: link, depth: nextDepth, foundOn: row.url });
    // Canonical and hreflang targets are crawled too, so their status can be checked.
    for (const extra of [parsed.canonical, ...parsed.hreflang.map((h) => h.href)]) {
      const url = extra ? normalizeUrl(extra) : null;
      if (url && url !== row.url && crawlable(url, rules)) links.push({ url, depth: nextDepth, foundOn: row.url });
    }
  }
  return { page, links, external: parsed?.externalLinks ?? [] };
}

async function storePage(db: Kysely<Database>, auditId: number, row: CrawlRow, page: CrawledPage): Promise<boolean> {
  const exists = await db.selectFrom("audit_pages").select("id").where("audit_id", "=", auditId).where("url_hash", "=", row.url_hash).executeTakeFirst();
  if (exists) return false;
  try {
    await db
      .insertInto("audit_pages")
      .values({
        audit_id: auditId,
        url: row.url,
        url_hash: row.url_hash,
        status_code: page.statusCode,
        redirect_to: page.redirects.length ? page.finalUrl.slice(0, 1000) : null,
        depth: page.depth,
        content_type: page.contentType || null,
        size_bytes: page.sizeBytes,
        load_ms: page.loadMs,
        title: page.title,
        meta_description: page.metaDescription,
        h1_count: page.headings[0],
        canonical: page.canonical ? page.canonical.slice(0, 1000) : null,
        robots_meta: [page.robotsMeta, page.xRobotsTag].filter(Boolean).join(", ").slice(0, 255) || null,
        word_count: page.wordCount,
        internal_links: page.internalLinks.length,
        external_links: page.externalLinks.length,
        inlinks: 0,
        data: serializePage(page),
        issues: "[]",
        fetched_at: now(),
      })
      .execute();
    return true;
  } catch {
    // Stored by a tick that died before marking the queue row done.
    return false;
  }
}

/** HEAD one external URL; error answers are confirmed with a GET (many servers mishandle HEAD). */
async function checkExternal(url: string, userAgent: string): Promise<{ state: "done" | "failed" | "skipped"; status: number | null }> {
  let res = await fetchOnce(url, { userAgent, method: "HEAD", timeoutMs: 8_000 });
  const local = (e: string | null) => Boolean(e && /Blocked|Private|Only |credentials|Invalid URL/.test(e));
  if ((res.status !== null && res.status >= 400) || (res.status === null && res.error !== "Timed out." && !local(res.error))) {
    res = await fetchOnce(url, { userAgent, readBody: () => false, timeoutMs: 8_000 });
  }
  if (res.status !== null) return { state: "done", status: res.status };
  if (!res.error || res.error === "Timed out." || local(res.error)) return { state: "skipped", status: null };
  return { state: "failed", status: null };
}

// ── The tick ──

export interface TickOptions {
  /** Epoch ms after which no new batch starts. */
  deadline: number;
  leaseMs?: number;
}

/**
 * Work on one audit until `deadline`: initialise it, crawl pages from the frontier, then
 * analyse. Returns null when another tick holds the audit (or it is not active).
 */
export async function runAuditTick(auditId: number, options: TickOptions): Promise<TickResult | null> {
  const db = await getDb();
  const leaseMs = options.leaseMs ?? LEASE_MS;
  let token = await acquire(db, auditId, leaseMs);
  if (!token) return null;
  let pages = 0;
  try {
    let audit = await db.selectFrom("audits").selectAll().where("id", "=", auditId).executeTakeFirstOrThrow();
    if (Date.parse(audit.created_at) < Date.now() - MAX_AUDIT_AGE_MS) {
      await failAudit(auditId, "The audit took more than 24 hours and was stopped.");
      return { auditId, pages, status: "failed" };
    }
    const project = await getProject(audit.project_id);
    if (!project) {
      await failAudit(auditId, "The project no longer exists.", { silent: true });
      return { auditId, pages, status: "failed" };
    }
    const startedIn = audit.status;
    let settings = readAuditSettings(audit.settings);
    if (audit.status === "queued") {
      if (!(await initAudit(db, audit, project, settings))) return { auditId, pages, status: "failed" };
      audit = await db.selectFrom("audits").selectAll().where("id", "=", auditId).executeTakeFirstOrThrow();
      settings = readAuditSettings(audit.settings);
      token = await renew(db, auditId, token, leaseMs);
      if (!token) return { auditId, pages, status: audit.status };
    }
    if (audit.status === "crawling") {
      const rules = rulesFor(settings, crawlerUserAgent(settings.userAgent, await siteUrl()));
      const concurrency = rules.delayMs > 0 ? 1 : CONCURRENCY;
      const limit = audit.pages_limit > 0 ? audit.pages_limit : settings.pageLimit;
      let externalQueued = Number(
        (await db.selectFrom("audit_queue").select((eb) => eb.fn.countAll<number>().as("n")).where("audit_id", "=", auditId).where("depth", "<", 0).executeTakeFirst())?.n ?? 0,
      );
      let analyzing = false;
      // The first batch always runs, so every tick makes progress whatever its budget.
      for (let first = true; first || Date.now() < options.deadline; first = false) {
        const crawled = await countPages(db, auditId);
        if (crawled >= limit) {
          // Page cap reached: the rest of the frontier is skipped.
          await db.updateTable("audit_queue").set({ state: "skipped" }).where("audit_id", "=", auditId).where("state", "=", "pending").where("depth", ">=", 0).execute();
        }
        const rows: CrawlRow[] =
          crawled >= limit
            ? []
            : await db
                .selectFrom("audit_queue")
                .select(["id", "url", "url_hash", "depth", "found_on"])
                .where("audit_id", "=", auditId)
                .where("state", "=", "pending")
                .where("depth", ">=", 0)
                .orderBy("depth")
                .orderBy("id")
                .limit(Math.min(concurrency, limit - crawled))
                .execute();
        if (!rows.length) {
          const ext = await db
            .selectFrom("audit_queue")
            .select(["id", "url"])
            .where("audit_id", "=", auditId)
            .where("state", "=", "pending")
            .where("depth", "<", 0)
            .orderBy("id")
            .limit(EXTERNAL_BATCH)
            .execute();
          if (!ext.length) {
            await db.updateTable("audits").set({ status: "analyzing", pages_crawled: crawled, updated_at: now() }).where("id", "=", auditId).where("status", "=", "crawling").execute();
            analyzing = true;
            break;
          }
          const results = await Promise.all(ext.map((e) => checkExternal(e.url, rules.userAgent)));
          for (let i = 0; i < ext.length; i++) {
            await db.updateTable("audit_queue").set({ state: results[i].state, status_code: results[i].status, attempts: 1 }).where("id", "=", ext[i].id).execute();
          }
        } else {
          await db.updateTable("audit_queue").set((eb) => ({ attempts: eb("attempts", "+", 1) })).where("id", "in", rows.map((r) => r.id)).execute();
          const results = await Promise.all(rows.map((row) => crawlPage(row, rules)));
          let stored = 0;
          for (let i = 0; i < rows.length; i++) {
            const { page, links, external } = results[i];
            if (await storePage(db, auditId, rows[i], page)) stored++;
            await enqueue(db, auditId, links);
            if (externalQueued < EXTERNAL_SAMPLE && external.length) {
              const sample = external.slice(0, EXTERNAL_SAMPLE - externalQueued).map((url) => ({ url, depth: -1, foundOn: rows[i].url }));
              externalQueued += await enqueue(db, auditId, sample);
            }
            await db.updateTable("audit_queue").set({ state: "done" }).where("id", "=", rows[i].id).execute();
          }
          pages += stored;
          if (stored) await incrementUsage(project.userId, { auditPages: stored });
          await db.updateTable("audits").set({ pages_crawled: crawled + stored, updated_at: now() }).where("id", "=", auditId).execute();
        }
        token = await renew(db, auditId, token, leaseMs);
        if (!token) break;
        if (rules.delayMs > 0 && rows.length) await sleep(Math.min(rules.delayMs, Math.max(0, options.deadline - Date.now())));
      }
      if (analyzing && token) audit = { ...audit, status: "analyzing" };
    }
    // Analyse when the tick started in that phase, or when the crawl finished with time to spare.
    if (token && audit.status === "analyzing" && (startedIn === "analyzing" || Date.now() < options.deadline)) {
      await analyzeAudit(auditId);
      return { auditId, pages, status: "done" };
    }
    const latest = await db.selectFrom("audits").select("status").where("id", "=", auditId).executeTakeFirst();
    return { auditId, pages, status: latest?.status ?? "failed" };
  } finally {
    if (token) await release(db, auditId, token).catch(() => undefined);
  }
}

/** Audits that are waiting for work (oldest first), for the scheduler job. */
export async function activeAuditIds(limit = 5): Promise<number[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("audits")
    .select("id")
    .where("status", "in", [...ACTIVE_STATUSES])
    .where((eb) => eb.or([eb("locked_until", "is", null), eb("locked_until", "<", iso(Date.now()))]))
    .orderBy("updated_at")
    .limit(limit)
    .execute();
  return rows.map((r) => r.id);
}
