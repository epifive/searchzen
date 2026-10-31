import "server-only";
import type { Insertable, Kysely } from "kysely";
import { AUDIT_CHECKS } from "../audit/checks";
import { dupKey, indexable } from "../audit/checks/helpers";
import type { AuditDiff } from "../audit/store";
import type { AuditSettingsJson, CrawledPage, SiteContext, SiteFacts } from "../audit/types";
import { urlHash } from "../audit/url";
import { simulateSerp } from "../serp/providers/simulated";
import { randomToken, sha256 } from "../tokens";
import { DEFAULT_PROJECT_SETTINGS, expectedCtr, healthScore, keywordIdentity, nextCheckAt, normalizeKeyword, normalizeProjectSettings, normalizeTags } from "@/seo/normalize";
import type { AlertEvent, AuditSummary, CheckFrequency, Device, ProjectSettings, RankDepth, SerpFeature, SerpResult, Severity } from "@/seo/types";
import type { Database } from "./schema";

/**
 * Sample SEO projects for a public demo (called by demo-seed.ts inside its transaction):
 *
 *   - "Northwind Outdoor" (admin): outdoor gear shop, US desktop, 56 keywords with tags, three
 *     competitors, 90 days of rankings that improve steadily (an SEO campaign), two finished
 *     site audits (health 71 → 84 with the fixed / new issues), Search Console data, a weekly
 *     report email, a public report link, report branding, rank alert rules with an email channel;
 *   - "Acme Cloud" (admin): B2B SaaS, desktop + mobile, US + GB keywords, a ranking dip around
 *     a "core update" and the recovery, two audits and Search Console data;
 *   - "Café Lumière" (admin): a café in Paris, FR/fr, mobile, local keywords with local packs,
 *     one audit;
 *   - one small project (a few keywords, 30 days, no audit) for three sample customers.
 *
 * Positions come from the Simulated provider's model (simulateSerp) day by day, plus each
 * project's storyline offset that fades to zero today, so today's rows are exactly what the
 * scheduled checks (DEMO_MODE uses the Simulated provider) produce, and they continue tomorrow
 * (next_check_at) without a gap or a duplicate day. Audits run the real check registry over
 * generated pages, so issues, scores and the diff match what the crawler would store.
 * Search Console rows (gsc_property set, gsc_connection_id NULL = demo data that the import
 * job never touches) follow the tracked positions. Deterministic except for the share token;
 * about 13,000 rows in multi-row inserts, so a remote database seeds within one request.
 */

type Db = Kysely<Database>;
type Rand = () => number;

const DAY = 86_400_000;
const MIN = 60_000;
/** Days of rank history of the administrator's projects (today included). */
const HISTORY_DAYS = 90;
const CUSTOMER_DAYS = 30;
/** Results depth of the demo's rank checks (settings row serp_depth, see src/lib/serp/index.ts). */
const DEPTH: RankDepth = 100;
/** Search Console data ends this many days ago (final data lags, see src/lib/gsc/import.ts). */
const GSC_LAG = 2;
const GSC_DAYS = 90;
const SNAPSHOT_SIZE = 20;
const CHUNK = 400;
const PAGE_CHUNK = 60;

// ── Deterministic helpers ──

function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32), independent of the caller's sequence. */
function seeded(seed: string): Rand {
  let a = hash32(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable number in [0, 1) for a label. */
const unit = (label: string) => seeded(label)();
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
const titleCase = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_, a: string, c: string) => a + c.toUpperCase());
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

async function insertChunked<T extends keyof Database & string>(trx: Db, table: T, rows: Array<Insertable<Database[T]>>, size = CHUNK): Promise<number> {
  for (let i = 0; i < rows.length; i += size) await trx.insertInto(table).values(rows.slice(i, i + size) as never).execute();
  return rows.length;
}

async function upsertSetting(trx: Db, key: string, value: string, onlyIfMissing = false): Promise<void> {
  const exists = await trx.selectFrom("settings").select("key").where("key", "=", key).executeTakeFirst();
  if (exists) {
    if (!onlyIfMissing) await trx.updateTable("settings").set({ value }).where("key", "=", key).execute();
    return;
  }
  await trx.insertInto("settings").values({ key, value }).execute();
}

/** Next weekly report slot (Monday 07:00 UTC) strictly after `from` (same rule as src/lib/reports/schedules.ts). */
function nextMonday(from: number): number {
  const d = new Date(from);
  const weekday = d.getUTCDay() || 7;
  let candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (weekday - 1), 7);
  while (candidate <= from) candidate += 7 * DAY;
  return candidate;
}

// ── Project and keyword specs ──

interface KeywordSpec {
  phrase: string;
  /** Daily searches (Search Console impressions when ranking on page one). */
  volume: number;
  tags: string[];
  device?: Device;
  country?: string;
  language?: string;
  location?: string;
  /** "ranking" = the page that ranks today; a path = another page (shows a target mismatch). */
  target?: string;
}

const kw = (phrase: string, volume: number, tags: string[], extra: Partial<KeywordSpec> = {}): KeywordSpec => ({ phrase, volume, tags, ...extra });

interface ProjectSpec {
  key: string;
  ownerId: number;
  name: string;
  domain: string;
  createdDaysAgo: number;
  days: number;
  frequency: CheckFrequency;
  settings: Partial<ProjectSettings>;
  keywords: KeywordSpec[];
  /** Places added to the simulated position `daysAgo` days back (0 today, so today is unchanged). */
  story?: (daysAgo: number, position: number) => number;
  /** Days of history computed beyond `days` (Search Console uses them). */
  extraDays?: number;
}

const NW_DOMAIN = "northwindoutdoor.example";
const ACME_DOMAIN = "acmecloud.example";
const CAFE_DOMAIN = "cafe-lumiere.example";

const NORTHWIND_KEYWORDS: KeywordSpec[] = [
  kw("northwind outdoor", 260, ["brand"]),
  kw("northwind outdoor coupon", 70, ["brand"]),
  kw("northwind outdoor reviews", 40, ["brand"]),
  kw("northwind outdoor store", 30, ["brand"]),
  kw("hiking boots", 900, ["product", "footwear"], { target: "/collections/hiking-boots" }),
  kw("waterproof hiking boots", 420, ["product", "footwear"], { target: "ranking" }),
  kw("womens hiking boots", 380, ["product", "footwear"], { target: "ranking" }),
  kw("trail running shoes", 650, ["product", "footwear"], { target: "ranking" }),
  kw("2 person backpacking tent", 210, ["product", "camping"], { target: "ranking" }),
  kw("ultralight tent", 260, ["product", "camping"]),
  kw("family camping tent", 300, ["product", "camping"], { target: "ranking" }),
  kw("sleeping bag", 700, ["product", "camping"], { target: "/collections/sleeping-bags" }),
  kw("down sleeping bag", 180, ["product", "camping"]),
  kw("20 degree sleeping bag", 140, ["product", "camping"]),
  kw("sleeping pad", 330, ["product", "camping"], { target: "ranking" }),
  kw("hiking backpack", 480, ["product", "packs"], { target: "ranking" }),
  kw("65l backpacking pack", 90, ["product", "packs"]),
  kw("daypack", 220, ["product", "packs"]),
  kw("rain jacket", 600, ["product", "apparel"], { target: "ranking" }),
  kw("down jacket", 520, ["product", "apparel"]),
  kw("fleece jacket", 400, ["product", "apparel"]),
  kw("merino wool base layer", 160, ["product", "apparel"]),
  kw("hiking socks", 280, ["product", "apparel"]),
  kw("trekking poles", 240, ["product"]),
  kw("camping stove", 260, ["product", "camping"], { target: "ranking" }),
  kw("backpacking stove", 150, ["product", "camping"]),
  kw("water filter for hiking", 170, ["product"]),
  kw("headlamp", 310, ["product"]),
  kw("camping hammock", 200, ["product", "camping"]),
  kw("camp chair", 290, ["product", "camping"]),
  kw("climbing harness", 120, ["product"]),
  kw("insulated water bottle", 230, ["product"]),
  kw("how to choose hiking boots", 150, ["blog"], { target: "ranking" }),
  kw("best hiking trails in colorado", 260, ["blog"]),
  kw("what to pack for a camping trip", 190, ["blog"]),
  kw("how to layer for hiking", 90, ["blog"]),
  kw("backpacking checklist", 170, ["blog"], { target: "ranking" }),
  kw("how to waterproof a tent", 60, ["blog"]),
  kw("sleeping bag temperature rating", 80, ["blog"]),
  kw("camping for beginners", 140, ["blog"]),
  kw("how to clean hiking boots", 70, ["blog"]),
  kw("leave no trace principles", 110, ["blog"]),
  kw("ultralight backpacking tips", 75, ["blog"]),
  kw("winter camping tips", 95, ["blog"]),
  kw("how to pitch a tent in the rain", 40, ["blog"]),
  kw("easy camping recipes", 160, ["blog"]),
  kw("hiking with dogs", 85, ["blog"]),
  kw("how to read a topographic map", 55, ["blog"]),
  kw("outdoor gear store denver", 90, ["local"], { location: "Denver, Colorado" }),
  kw("camping store near me", 160, ["local"], { location: "Denver, Colorado" }),
  kw("tent rental denver", 30, ["local"], { location: "Denver, Colorado" }),
  kw("climbing gear denver", 25, ["local"], { location: "Denver, Colorado" }),
  kw("hiking store seattle", 50, ["local"], { location: "Seattle, Washington" }),
  kw("ski shop seattle", 45, ["local"], { location: "Seattle, Washington" }),
  kw("outdoor store portland", 60, ["local"], { location: "Portland, Oregon" }),
  kw("kayak rental portland", 35, ["local"], { location: "Portland, Oregon" }),
];

const MOBILE = { device: "mobile" as const };
const GB = { country: "GB" };
const ACME_KEYWORDS: KeywordSpec[] = [
  kw("acme cloud", 180, ["brand"]),
  kw("acme cloud login", 140, ["brand"], MOBILE),
  kw("acme cloud pricing", 45, ["brand"], { target: "/pricing" }),
  kw("cloud storage for business", 260, ["product"], { target: "ranking" }),
  kw("secure file sharing", 210, ["product"], { ...MOBILE, target: "ranking" }),
  kw("online backup service", 180, ["product"], { target: "ranking" }),
  kw("cloud backup for small business", 120, ["product"]),
  kw("s3 compatible storage", 90, ["product", "developers"], { target: "ranking" }),
  kw("object storage pricing", 60, ["product", "developers"]),
  kw("team file sync", 50, ["product"], MOBILE),
  kw("encrypted cloud storage", 140, ["product"], MOBILE),
  kw("dropbox alternative", 170, ["comparison"], MOBILE),
  kw("google drive alternative for business", 60, ["comparison"]),
  kw("file versioning", 40, ["product"]),
  kw("hipaa compliant cloud storage", 55, ["product", "compliance"]),
  kw("ransomware protection backup", 45, ["product"]),
  kw("nas cloud backup", 35, ["product"]),
  kw("cloud storage api", 50, ["developers"]),
  kw("best cloud storage for small business", 150, ["blog", "comparison"]),
  kw("how to back up a website", 90, ["blog"]),
  kw("3-2-1 backup rule", 120, ["blog"], { target: "ranking" }),
  kw("cloud vs local backup", 70, ["blog"]),
  kw("what is object storage", 110, ["blog"], MOBILE),
  kw("how to share large files", 160, ["blog"], MOBILE),
  kw("gdpr cloud storage", 40, ["blog", "compliance"]),
  kw("immutable backups", 30, ["blog"]),
  kw("cloud storage for business", 140, ["product", "uk"], { ...GB, ...MOBILE }),
  kw("online backup service", 90, ["product", "uk"], GB),
  kw("secure file sharing uk", 60, ["product", "uk"], GB),
  kw("gdpr compliant cloud storage", 50, ["compliance", "uk"], GB),
  kw("cloud backup uk", 70, ["product", "uk"], { ...GB, ...MOBILE }),
  kw("business cloud storage uk", 45, ["product", "uk"], GB),
];

const DESKTOP = { device: "desktop" as const };
const CAFE_KEYWORDS: KeywordSpec[] = [
  kw("café lumière", 40, ["marque"]),
  kw("café lumière paris", 25, ["marque"], DESKTOP),
  kw("café de spécialité paris", 90, ["café"]),
  kw("brunch paris 11", 120, ["brunch"]),
  kw("brunch dimanche paris", 140, ["brunch"], DESKTOP),
  kw("coffee shop paris", 110, ["café"]),
  kw("salon de thé paris", 70, ["café"], DESKTOP),
  kw("café avec wifi paris", 50, ["café"]),
  kw("petit déjeuner paris", 80, ["brunch"]),
  kw("torréfacteur paris", 35, ["boutique"], DESKTOP),
];

const CUSTOMER_PROJECTS: Array<{ name: string; domain: string; settings: Partial<ProjectSettings>; keywords: KeywordSpec[] }> = [
  {
    name: "Bloom & Petal",
    domain: "bloomandpetal.example",
    settings: {},
    keywords: [kw("bloom and petal", 20, ["brand"]), kw("same day flower delivery", 120, []), kw("wedding florist", 60, []), kw("birthday flowers", 90, [])],
  },
  {
    name: "Kettle Peak Fitness",
    domain: "kettlepeak.example",
    settings: { device: "mobile" },
    keywords: [kw("kettlebell workouts", 80, ["blog"]), kw("home gym equipment", 140, ["shop"]), kw("adjustable kettlebell", 60, ["shop"]), kw("kettle peak", 15, ["brand"])],
  },
  {
    name: "Lumen Dental Studio",
    domain: "lumendental.example",
    settings: { location: "Austin, Texas", device: "mobile" },
    keywords: [kw("dentist near me", 200, ["local"]), kw("teeth whitening", 90, ["local"]), kw("invisalign cost", 70, []), kw("emergency dentist", 110, ["local"])],
  },
];

// ── Rank history ──

interface DayRank {
  day: string;
  daysAgo: number;
  position: number | null;
  url: string | null;
  features: SerpFeature[];
  competitors: Record<string, number | null>;
  checkedAt: string;
}

interface KeywordPlan {
  spec: KeywordSpec;
  phrase: string;
  country: string;
  language: string;
  device: Device;
  location: string;
  brand: boolean;
  /** Stored days (oldest first). */
  history: DayRank[];
  /** Every computed day by days ago (history plus extraDays). */
  byAgo: Map<number, DayRank>;
  results: SerpResult[];
}

function planKeywords(spec: ProjectSpec, settings: ProjectSettings, nowMs: number): KeywordPlan[] {
  const step = spec.frequency === "weekly" ? 7 : 1;
  const extra = spec.extraDays ?? 0;
  return spec.keywords.map((k, index) => {
    const phrase = normalizeKeyword(k.phrase);
    const plan: KeywordPlan = {
      spec: k,
      phrase,
      country: k.country ?? settings.country,
      language: k.language ?? settings.language,
      device: k.device ?? settings.device,
      location: k.location ?? settings.location,
      brand: k.tags.includes("brand") || k.tags.includes("marque"),
      history: [],
      byAgo: new Map(),
      results: [],
    };
    const input = {
      phrase,
      country: plan.country,
      language: plan.language,
      device: plan.device,
      location: plan.location,
      depth: DEPTH,
      domain: spec.domain,
      competitors: settings.competitors,
    };
    // The checks of a project run a few seconds apart, a few minutes before "now" each day.
    const offsetMs = 4 * MIN + index * 4000;
    for (let ago = spec.days - 1 + extra; ago >= 0; ago--) {
      const stored = ago < spec.days && ago % step === 0;
      if (!stored && ago < spec.days) continue;
      const day = dayOf(nowMs - ago * DAY);
      const r = simulateSerp(input, day);
      let position = r.position;
      if (position !== null && spec.story && !plan.brand) {
        // Deep keywords stay on the last results pages instead of dropping out (a steady average position).
        const moved = Math.max(1, Math.round(position + spec.story(ago, position)));
        position = moved > 90 ? Math.max(position, 90 + Math.floor(unit(`${phrase}|${ago}`) * 10)) : moved;
      }
      if (position !== null && position > DEPTH) position = null;
      const checkedMs = Math.max(Date.parse(`${day}T00:00:00.000Z`) + index * 1000, nowMs - ago * DAY - offsetMs);
      const row: DayRank = {
        day,
        daysAgo: ago,
        position,
        url: position === null ? null : r.url,
        features: r.features,
        competitors: r.competitors,
        checkedAt: new Date(checkedMs).toISOString(),
      };
      plan.byAgo.set(ago, row);
      if (stored) plan.history.push(row);
      if (ago === 0) plan.results = r.results.slice(0, SNAPSHOT_SIZE);
    }
    return plan;
  });
}

// ── Search Console ──

interface GscConfig {
  queries: number;
  pages: number;
  /** Demand by UTC weekday (0 = Sunday). */
  weekly: number[];
  /** Demand growth over the 90 days (0.1 = +10 %). */
  growth: number;
  /** Long-tail queries Search Console doesn't list (anonymised / beyond the top rows), relative to the listed ones. */
  tail: { impressions: number; clicks: number; position: number };
  /** Pages besides the ranking ones that get long-tail traffic. */
  extraPages: string[];
}

type GscRow = Insertable<Database["gsc_daily"]>;

/** Share of a query's searches in which a result at `position` is shown (page one ≈ all, deeper pages rarely). */
function impressionShare(position: number): number {
  if (position <= 10) return 1 - (position - 1) * 0.025;
  if (position <= 20) return 0.16;
  if (position <= 30) return 0.05;
  if (position <= 50) return 0.018;
  return 0.004;
}

function buildGsc(projectId: number, domain: string, plans: KeywordPlan[], cfg: GscConfig, rand: Rand, nowMs: number): GscRow[] {
  const byPhrase = new Map<string, KeywordPlan>();
  // Brand searches first (they bring most clicks), then by search volume.
  for (const p of [...plans].sort((a, b) => Number(b.brand) - Number(a.brand) || b.spec.volume - a.spec.volume)) if (!p.location && !byPhrase.has(p.phrase)) byPhrase.set(p.phrase, p);
  const queries = [...byPhrase.values()].slice(0, cfg.queries);
  const sitePages = [...new Set([`https://${domain}/`, ...plans.map((p) => p.byAgo.get(0)?.url).filter((u): u is string => Boolean(u)), ...cfg.extraPages.map((p) => `https://${domain}${p}`)])];
  const pageWeight = new Map(sitePages.map((u) => [u, u.endsWith(`${domain}/`) ? 3 : 0.3 + unit(`gsc-page|${u}`)]));
  const weightSum = [...pageWeight.values()].reduce((a, b) => a + b, 0);
  const rows: GscRow[] = [];
  const row = (day: string, query: string, page: string, clicks: number, impressions: number, position: number): GscRow => ({
    project_id: projectId,
    day,
    query,
    page,
    clicks,
    impressions,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : 0,
    position: Math.round(position * 100) / 100,
  });
  for (let ago = GSC_LAG + GSC_DAYS - 1; ago >= GSC_LAG; ago--) {
    const ms = nowMs - ago * DAY;
    const day = dayOf(ms);
    const demand = cfg.weekly[new Date(ms).getUTCDay()] * (1 + cfg.growth * (1 - ago / (GSC_LAG + GSC_DAYS)));
    let sumClicks = 0;
    let sumImpr = 0;
    let sumWeighted = 0;
    const byPage = new Map<string, { clicks: number; impressions: number; weighted: number }>();
    const addPage = (url: string, clicks: number, impressions: number, position: number) => {
      const p = byPage.get(url) ?? { clicks: 0, impressions: 0, weighted: 0 };
      p.clicks += clicks;
      p.impressions += impressions;
      p.weighted += position * impressions;
      byPage.set(url, p);
    };
    for (const q of queries) {
      const r = q.byAgo.get(ago);
      if (!r || r.position === null || !r.url) continue;
      // Search Console averages over devices and locations: close to the tracked position, rarely exact.
      const position = Math.max(1, r.position + (rand() - 0.3) * (q.brand ? 0.4 : 1.6));
      const impressions = Math.round(q.spec.volume * demand * impressionShare(position) * (0.85 + rand() * 0.3));
      // Search Console leaves out queries with very few impressions (privacy filtering).
      if (impressions < 2) continue;
      const ctr = q.brand ? 0.36 + rand() * 0.12 : expectedCtr(Math.round(position)) * (0.75 + rand() * 0.5);
      const clicks = Math.min(impressions, Math.round(impressions * ctr));
      rows.push(row(day, q.phrase, "", clicks, impressions, position));
      sumClicks += clicks;
      sumImpr += impressions;
      sumWeighted += position * impressions;
      addPage(r.url, clicks, impressions, position);
    }
    const tailImpr = Math.round(sumImpr * cfg.tail.impressions * (0.9 + rand() * 0.2));
    const tailClicks = Math.round(sumClicks * cfg.tail.clicks * (0.9 + rand() * 0.2));
    const tailPosition = cfg.tail.position * (0.92 + rand() * 0.16);
    // The long tail lands on every page of the site in fixed shares (the last page takes the rest).
    let restImpr = tailImpr;
    let restClicks = tailClicks;
    sitePages.forEach((url, i) => {
      const share = pageWeight.get(url)! / weightSum;
      const impr = i === sitePages.length - 1 ? restImpr : Math.min(restImpr, Math.round(tailImpr * share));
      const clicks = i === sitePages.length - 1 ? restClicks : Math.min(restClicks, Math.round(tailClicks * share));
      restImpr -= impr;
      restClicks -= clicks;
      if (impr > 0) addPage(url, Math.min(clicks, impr), impr, tailPosition);
    });
    const totalImpr = sumImpr + tailImpr;
    if (totalImpr < 1) continue;
    rows.push(row(day, "", "", sumClicks + tailClicks, totalImpr, (sumWeighted + tailPosition * tailImpr) / totalImpr));
    const topPages = [...byPage.entries()].sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions).slice(0, cfg.pages);
    for (const [url, p] of topPages) rows.push(row(day, "", url, p.clicks, p.impressions, p.weighted / p.impressions));
  }
  return rows;
}

// ── Site audits ──

interface PageDef {
  path: string;
  kind: "home" | "collection" | "product" | "landing" | "blog" | "guide" | "info" | "listing" | "missing" | "redirect" | "noindex";
  title: string;
  h1: string;
  description: string;
  words: number;
  links: string[];
  external?: string[];
  images?: number;
  schema?: string[];
  /** Listed in the XML sitemap (default true for 200 pages). */
  sitemap?: boolean;
  status?: number;
  /** Redirect: the hops after this URL; the last one is the final page. */
  hops?: string[];
}

/** Share of the pages with each generic on-page problem, per audit (the same pages keep a problem until it is fixed). */
interface DefectRates {
  metaMissing: number;
  metaShort: number;
  metaLong: number;
  titleLong: number;
  titleDup: number;
  metaDup: number;
  h1Missing: number;
  h1Multiple: number;
  altMissing: number;
  thin: number;
  canonicalMissing: number;
  ogMissing: number;
  twitterMissing: number;
  noSchema: number;
  slow: number;
}

interface SiteBuild {
  pages: PageDef[];
  rates: DefectRates;
  /** Paths with mixed content (http:// images). */
  mixed: string[];
  /** Pages that gained a problem since the first audit (new posts without alt text…). */
  forced: Partial<Record<keyof DefectRates, string[]>>;
  /** External link → status (broken ones are reported). */
  externalStatus: Map<string, number | null>;
  facts: Partial<SiteFacts>;
  lang: string;
  dupTitle: string;
  dupDescription: string;
  brandSuffix: string;
}

function makeFacts(domain: string, pages: number, over: Partial<SiteFacts>): SiteFacts {
  const origin = `https://${domain}`;
  return {
    origin,
    host: domain,
    https: true,
    robotsTxt: { found: true, valid: true, disallowAll: false, sitemaps: [`${origin}/sitemap.xml`] },
    robotsText: `User-agent: *\nDisallow: /cart\nDisallow: /checkout\nDisallow: /account\n\nSitemap: ${origin}/sitemap.xml\n`,
    robotsDelayMs: 0,
    sitemap: { found: true, valid: true, urls: pages },
    httpRedirectsToHttps: true,
    faviconIco: true,
    startRedirectedTo: null,
    ...over,
  };
}

/** The pages as the crawler would have stored them. */
function crawlSite(key: string, domain: string, build: SiteBuild): CrawledPage[] {
  const origin = `https://${domain}`;
  const abs = (path: string) => (path.startsWith("http") ? path : `${origin}${path}`);
  const r = build.rates;
  const has = (path: string, defect: keyof DefectRates) => (build.forced[defect]?.includes(path) ?? false) || unit(`${key}|${path}|${defect}`) < r[defect];
  return build.pages.map((def) => {
    const rnd = seeded(`${key}|${def.path}|page`);
    const url = abs(def.path);
    const ttfb = Math.round(90 + rnd() * 380);
    const base: CrawledPage = {
      url,
      finalUrl: url,
      statusCode: def.status ?? 200,
      redirects: [],
      depth: 0,
      contentType: "text/html; charset=utf-8",
      sizeBytes: 0,
      ttfbMs: ttfb,
      loadMs: ttfb + Math.round(40 + rnd() * 260),
      encoding: "br",
      xRobotsTag: "",
      isHtml: true,
      title: null,
      metaDescription: null,
      h1: [],
      canonical: null,
      robotsMeta: "",
      lang: "",
      viewport: false,
      wordCount: 0,
      internalLinks: [],
      externalLinks: [],
      imagesWithoutAlt: 0,
      imagesTotal: 0,
      mixedContent: [],
      hreflang: [],
      openGraph: {},
      twitterCard: {},
      jsonLd: [],
      favicon: false,
      inlinks: 0,
      error: null,
      finalStatus: def.status ?? 200,
      redirectLoop: false,
      headings: [0, 0, 0, 0, 0, 0],
      scripts: 0,
      styles: 0,
      nofollowLinks: 0,
      linksTotal: 0,
      imagesWithoutSize: 0,
      images: [],
      canonicalCount: 0,
      charset: "",
      inSitemap: false,
    };
    if (def.hops?.length) {
      const chain = [url, ...def.hops.slice(0, -1).map(abs)];
      return {
        ...base,
        statusCode: 301,
        redirects: chain.map((u) => ({ url: u, status: 301 })),
        finalUrl: abs(def.hops[def.hops.length - 1]),
        finalStatus: 200,
        isHtml: false,
        contentType: "text/html; charset=utf-8",
        encoding: "",
        loadMs: base.ttfbMs + 30 * chain.length,
        inSitemap: def.sitemap ?? false,
      };
    }
    if ((def.status ?? 200) !== 200) {
      return { ...base, sizeBytes: Math.round(7000 + rnd() * 3000), encoding: "br", inSitemap: def.sitemap ?? false };
    }
    let title = def.title;
    let description = def.description;
    if (has(def.path, "titleDup") && def.kind !== "home") title = build.dupTitle;
    else if (has(def.path, "titleLong")) title = `${def.title.replace(build.brandSuffix, "")} | ${build.dupTitle}`;
    if (has(def.path, "metaMissing")) description = "";
    else if (has(def.path, "metaDup") && def.kind !== "home") description = build.dupDescription;
    else if (has(def.path, "metaShort")) description = description.split(/[.,]/)[0].slice(0, 60);
    else if (has(def.path, "metaLong")) description = `${description} ${build.dupDescription}`;
    const h1Count = has(def.path, "h1Missing") ? 0 : has(def.path, "h1Multiple") ? 2 : 1;
    const images = def.images ?? Math.round(3 + rnd() * 8);
    const noAlt = has(def.path, "altMissing") ? 1 + Math.floor(rnd() * Math.min(4, images)) : 0;
    const words = has(def.path, "thin") && def.kind !== "home" ? Math.round(70 + rnd() * 110) : def.words;
    const internal = [...new Set(def.links.map(abs))].filter((l) => l !== url);
    const external = def.external ?? [];
    const slow = has(def.path, "slow");
    const ttfbMs = slow ? Math.round(1600 + rnd() * 1300) : base.ttfbMs;
    const ogMissing = has(def.path, "ogMissing");
    const schema = has(def.path, "noSchema") ? [] : (def.schema ?? ["WebPage"]);
    const imageList = Array.from({ length: Math.min(images, 4) }, (_, i) => ({
      src: `${origin}/cdn/images/${slugify(def.h1).slice(0, 40) || "page"}-${i + 1}.webp`,
      alt: i < noAlt ? null : `${def.h1} ${i + 1}`,
      width: "800",
      height: "600",
    }));
    return {
      ...base,
      sizeBytes: Math.round(38_000 + words * 18 + rnd() * 45_000),
      ttfbMs,
      loadMs: ttfbMs + Math.round(60 + rnd() * 320),
      title: title || null,
      metaDescription: description || null,
      h1: h1Count === 0 ? [] : h1Count === 2 ? [def.h1, "Customer reviews"] : [def.h1],
      canonical: has(def.path, "canonicalMissing") ? null : url,
      lang: build.lang,
      viewport: true,
      wordCount: words,
      internalLinks: internal,
      externalLinks: external,
      imagesWithoutAlt: noAlt,
      imagesTotal: images,
      mixedContent: build.mixed.includes(def.path) ? [`http://${domain}/cdn/images/${slugify(def.h1).slice(0, 30)}-legacy.jpg`] : [],
      openGraph: ogMissing ? { "og:title": title } : { "og:title": title, "og:description": description || title, "og:image": `${origin}/cdn/og/${slugify(def.h1).slice(0, 40) || "home"}.jpg`, "og:type": "website" },
      twitterCard: has(def.path, "twitterMissing") ? {} : { "twitter:card": "summary_large_image" },
      jsonLd: schema.map((t) => ({ valid: true, types: [t] })),
      favicon: true,
      headings: [h1Count, 2 + Math.floor(rnd() * 6), Math.floor(rnd() * 8), 0, 0, 0],
      scripts: Math.round(9 + rnd() * 12),
      styles: Math.round(2 + rnd() * 4),
      linksTotal: internal.length + external.length + Math.round(rnd() * 6),
      images: imageList,
      canonicalCount: has(def.path, "canonicalMissing") ? 0 : 1,
      charset: "utf-8",
      inSitemap: def.sitemap ?? def.kind !== "noindex",
      robotsMeta: def.kind === "noindex" ? "noindex, follow" : "",
    };
  });
}

interface IssueRow {
  pageIndex: number | null;
  code: string;
  severity: Severity;
  details: string;
}

interface Analysis {
  pages: CrawledPage[];
  issues: IssueRow[];
  codesByPage: string[][];
  summary: AuditSummary;
  score: number;
}

/** The analysis of src/lib/audit/analyze.ts (inlinks, click depth, every check, summary, score) in memory. */
function analyzePages(pages: CrawledPage[], facts: SiteFacts, startUrl: string, externalStatus: Map<string, number | null>): Analysis {
  const byUrl = new Map(pages.map((p, i) => [p.url, i]));
  const inlinks = new Array<number>(pages.length).fill(0);
  for (const page of pages) {
    if (!page.isHtml) continue;
    const targets = new Set<number>();
    for (const link of page.internalLinks) {
      const j = byUrl.get(link);
      if (j === undefined || link === page.url) continue;
      targets.add(j);
      const target = pages[j];
      if (target.redirects.length && !target.redirectLoop) {
        const k = byUrl.get(target.finalUrl);
        if (k !== undefined && target.finalUrl !== page.url) targets.add(k);
      }
    }
    for (const j of targets) inlinks[j]++;
  }
  const startIndex = Math.max(0, byUrl.get(startUrl) ?? 0);
  const dist = new Map<number, number>([[startIndex, 0]]);
  const queue: number[] = [startIndex];
  while (queue.length) {
    const i = queue.shift()!;
    const depth = dist.get(i)!;
    const page = pages[i];
    if (page.redirects.length && !page.redirectLoop) {
      const j = byUrl.get(page.finalUrl);
      if (j !== undefined && (dist.get(j) ?? Infinity) > depth) {
        dist.set(j, depth);
        queue.unshift(j);
      }
    }
    for (const link of page.internalLinks) {
      const j = byUrl.get(link);
      if (j !== undefined && (dist.get(j) ?? Infinity) > depth + 1) {
        dist.set(j, depth + 1);
        queue.push(j);
      }
    }
  }
  pages.forEach((p, i) => {
    p.inlinks = inlinks[i];
    p.depth = dist.get(i) ?? 10;
  });
  const dupMap = (value: (p: CrawledPage) => string | null | undefined) => {
    const map = new Map<string, string[]>();
    for (const p of pages) {
      if (!indexable(p)) continue;
      const k = dupKey(value(p));
      if (!k) continue;
      map.set(k, [...(map.get(k) ?? []), p.url]);
    }
    for (const [k, v] of map) if (v.length < 2) map.delete(k);
    return map;
  };
  const ctx: SiteContext = {
    startUrl,
    host: facts.host,
    https: facts.https,
    robotsTxt: facts.robotsTxt,
    sitemap: facts.sitemap,
    httpRedirectsToHttps: facts.httpRedirectsToHttps,
    duplicateTitles: dupMap((p) => p.title),
    duplicateDescriptions: dupMap((p) => p.metaDescription),
    statusByUrl: new Map(pages.map((p) => [p.url, p.statusCode])),
    facts,
    pagesByUrl: new Map(pages.map((p) => [p.url, p])),
    externalStatus,
    duplicateH1: dupMap((p) => p.h1[0]),
    sitemapUrls: new Set(pages.filter((p) => p.inSitemap).map((p) => p.url)),
    homeUrl: pages[startIndex].url,
    complete: true,
  };
  const issues: IssueRow[] = [];
  const codesByPage: string[][] = pages.map(() => []);
  const asList = <T,>(found: T | T[] | null | false | undefined): T[] => (!found ? [] : Array.isArray(found) ? found : [found]);
  for (const check of AUDIT_CHECKS) {
    if (check.test) {
      pages.forEach((page, i) => {
        const list = asList(check.test!(page, ctx));
        if (!list.length) return;
        const details = { ...(list[0].details ?? {}), ...(list.length > 1 ? { count: list.length } : {}) };
        issues.push({ pageIndex: i, code: check.code, severity: check.severity, details: JSON.stringify(details) });
        codesByPage[i].push(check.code);
      });
    }
    if (check.testSite) {
      const list = asList(check.testSite(ctx, pages));
      if (list.length) issues.push({ pageIndex: null, code: check.code, severity: check.severity, details: JSON.stringify(list[0].details ?? {}) });
    }
  }
  const summary: AuditSummary = { critical: 0, warning: 0, notice: 0, byCode: {}, pagesWithCritical: 0, pagesWithIssues: 0 };
  const critPages = new Set<number>();
  const issuePages = new Set<number>();
  for (const issue of issues) {
    summary[issue.severity]++;
    summary.byCode[issue.code] = (summary.byCode[issue.code] ?? 0) + 1;
    if (issue.pageIndex !== null) {
      issuePages.add(issue.pageIndex);
      if (issue.severity === "critical") critPages.add(issue.pageIndex);
    }
  }
  summary.pagesWithCritical = critPages.size;
  summary.pagesWithIssues = issuePages.size;
  const score = healthScore(
    issues.map((i) => ({ severity: i.severity, site: i.pageIndex === null })),
    pages.length,
  );
  return { pages, issues, codesByPage, summary, score };
}

const issueKeys = (a: Analysis) => a.issues.map((i) => `${i.code}|${i.pageIndex === null ? "" : a.pages[i.pageIndex].url}`);

function auditDiff(previous: { id: number; score: number; keys: string[] }, current: string[]): AuditDiff {
  const before = new Set(previous.keys);
  const now = new Set(current);
  const diff: AuditDiff = { previousAuditId: previous.id, previousScore: previous.score, newIssues: 0, fixedIssues: 0, newByCode: {}, fixedByCode: {} };
  const code = (k: string) => k.slice(0, k.indexOf("|"));
  for (const k of now) {
    if (before.has(k)) continue;
    diff.newIssues++;
    diff.newByCode[code(k)] = (diff.newByCode[code(k)] ?? 0) + 1;
  }
  for (const k of before) {
    if (now.has(k)) continue;
    diff.fixedIssues++;
    diff.fixedByCode[code(k)] = (diff.fixedByCode[code(k)] ?? 0) + 1;
  }
  return diff;
}

interface StoredAudit {
  id: number;
  score: number;
  pages: number;
  issues: number;
  keys: string[];
  finishedAt: string;
  summary: AuditSummary;
  diff: AuditDiff | null;
}

async function storeAudit(
  trx: Db,
  projectId: number,
  domain: string,
  build: SiteBuild,
  key: string,
  startedMs: number,
  previous: StoredAudit | null,
): Promise<StoredAudit> {
  const startUrl = `https://${domain}/`;
  const pages = crawlSite(key, domain, build);
  const facts = makeFacts(domain, pages.filter((p) => p.inSitemap).length, build.facts);
  const analysis = analyzePages(pages, facts, startUrl, build.externalStatus);
  const keys = issueKeys(analysis);
  const diff = previous ? auditDiff({ id: previous.id, score: previous.score, keys: previous.keys }, keys) : null;
  // About 2.2 s per page with the default crawl settings, then a few seconds of analysis.
  const finishedMs = startedMs + pages.length * 2200 + 9000;
  const settings: AuditSettingsJson = { startUrl, pageLimit: 500, maxDepth: 10, crawlDelayMs: 0, includePatterns: [], excludePatterns: [], userAgent: "bot", site: facts };
  const iso = (ms: number) => new Date(ms).toISOString();
  const res = await trx
    .insertInto("audits")
    .values({
      project_id: projectId,
      status: "done",
      triggered_by: "manual",
      settings: JSON.stringify(settings),
      started_at: iso(startedMs),
      finished_at: iso(finishedMs),
      pages_crawled: pages.length,
      pages_limit: 500,
      score: analysis.score,
      issues_summary: JSON.stringify(diff ? { ...analysis.summary, diff } : analysis.summary),
      error: null,
      locked_until: null,
      created_at: iso(startedMs - 1500),
      updated_at: iso(finishedMs),
    })
    .executeTakeFirstOrThrow();
  const auditId = Number(res.insertId);
  const pageRows = pages.map((p, i) => ({
    audit_id: auditId,
    url: p.url,
    url_hash: urlHash(p.url),
    status_code: p.statusCode,
    redirect_to: p.redirects.length ? p.finalUrl : null,
    depth: p.depth,
    content_type: p.contentType || null,
    size_bytes: p.sizeBytes,
    load_ms: p.loadMs,
    title: p.title,
    meta_description: p.metaDescription,
    h1_count: p.headings[0],
    canonical: p.canonical,
    robots_meta: [p.robotsMeta, p.xRobotsTag].filter(Boolean).join(", ") || null,
    word_count: p.wordCount,
    internal_links: p.internalLinks.length,
    external_links: p.externalLinks.length,
    inlinks: p.inlinks,
    // The crawler stores the data before the analysis (inlinks are only in the column).
    data: JSON.stringify({ ...p, inlinks: 0 }),
    issues: JSON.stringify(analysis.codesByPage[i]),
    fetched_at: iso(startedMs + 3000 + i * 2200),
  }));
  await insertChunked(trx, "audit_pages", pageRows, PAGE_CHUNK);
  const stored = await trx.selectFrom("audit_pages").select(["id", "url_hash"]).where("audit_id", "=", auditId).execute();
  const idByHash = new Map(stored.map((r) => [r.url_hash, r.id]));
  const issueRows = analysis.issues.map((issue) => ({
    audit_id: auditId,
    page_id: issue.pageIndex === null ? null : (idByHash.get(pageRows[issue.pageIndex].url_hash) ?? null),
    code: issue.code,
    severity: issue.severity,
    details: issue.details,
  }));
  await insertChunked(trx, "audit_issues", issueRows);
  return { id: auditId, score: analysis.score, pages: pages.length, issues: issueRows.length, keys, finishedAt: iso(finishedMs), summary: analysis.summary, diff };
}

// ── Site models ──

const NW_COLLECTIONS: Array<[slug: string, name: string, products: string[]]> = [
  ["tents", "Tents", ["Trailhawk 2P Ultralight Tent", "Basecamp 4 Family Tent", "Ridgeline 1P Bivy Tent", "Summit Dome 3P Tent", "Canyon Shelter Tarp"]],
  ["sleeping-bags", "Sleeping Bags", ["Aspen 20 Down Sleeping Bag", "Glacier 0 Mummy Bag", "Meadow 40 Synthetic Bag", "Campfire Kids Sleeping Bag", "Featherlite Quilt"]],
  ["backpacks", "Backpacks", ["Pathfinder 65L Pack", "Daytripper 24L Daypack", "Switchback 45L Pack", "Kestrel 18 Hydration Pack", "Voyager 80L Expedition Pack"]],
  ["hiking-boots", "Hiking Boots", ["Granite Peak Waterproof Boot", "Trailblazer Mid Hiker", "Alpine Ridge Women's Boot", "Scree Low Hiking Shoe", "Backcountry Leather Boot"]],
  ["jackets", "Jackets", ["Stormline Rain Jacket", "Ember Down Jacket", "Polar Grid Fleece", "Windward Softshell", "Cascade Women's Parka"]],
  ["camp-kitchen", "Camp Kitchen", ["Firefly Backpacking Stove", "Two-Burner Camp Stove", "Titanium Cook Set", "Collapsible Camp Sink", "Insulated Steel Bottle 32 oz"]],
  ["climbing", "Climbing", ["Crux Climbing Harness", "Boulder Chalk Bag", "Locking Carabiner Set", "Dynamic Rope 60 m", "Approach Shoe"]],
  ["trail-running", "Trail Running", ["Velocity Trail Runner", "Switchback Women's Trail Shoe", "Ultra Running Vest", "Merino Running Socks", "Trail Running Shorts"]],
];

/** Pages of the ranking URLs (today's simulated results) of a project, by kind. */
function rankingPages(plans: KeywordPlan[], domain: string): Array<{ path: string; phrase: string }> {
  const out = new Map<string, string>();
  for (const p of plans) {
    const url = p.byAgo.get(0)?.url;
    if (!url) continue;
    const path = url.slice(`https://${domain}`.length) || "/";
    if (path !== "/" && !out.has(path)) out.set(path, p.phrase);
  }
  return [...out.entries()].map(([path, phrase]) => ({ path, phrase }));
}

function kindOf(path: string): PageDef["kind"] {
  if (path.startsWith("/products/")) return "product";
  if (path.startsWith("/blog/")) return "blog";
  if (path.startsWith("/guides/")) return "guide";
  return "landing";
}

function northwindSite(plans: KeywordPlan[], version: 1 | 2): SiteBuild {
  const S = " | Northwind Outdoor";
  const pages: PageDef[] = [];
  const header = ["/", ...NW_COLLECTIONS.map(([slug]) => `/collections/${slug}`), "/blog", "/stores", "/sale"];
  const footer = ["/about", "/contact", "/shipping", "/returns", "/faq", "/gift-cards", "/privacy-policy", "/terms-of-service", "/careers", "/brands"];
  const nav = [...header, ...footer];
  const ranked = rankingPages(plans, NW_DOMAIN);
  const landing = ranked.filter((r) => kindOf(r.path) !== "blog");
  const blogRanked = ranked.filter((r) => kindOf(r.path) === "blog");
  const extraPosts = ["Spring Hiking Checklist", "Gear Review: Trailhawk 2P Tent", "Best National Parks for Camping", "How to Choose a Sleeping Pad", "Our Favorite Day Hikes Near Denver", "Trail Running for Beginners"];
  // Posts published after the first audit (new issues in the second one).
  const newPosts = ["Fall Layering Guide", "Packing List for a Thru-Hike", "Camp Coffee, Three Ways", "Shoulder Season Camping"];
  const posts = [
    ...blogRanked.map((r) => ({ path: r.path, title: titleCase(r.phrase) })),
    ...extraPosts.map((t) => ({ path: `/blog/${slugify(t)}`, title: t })),
    ...(version === 2 ? newPosts.map((t) => ({ path: `/blog/${slugify(t)}`, title: t })) : []),
  ];
  const products = NW_COLLECTIONS.flatMap(([slug, , names]) => names.map((n) => ({ collection: slug, name: n, path: `/products/${slugify(n)}` })));
  const discontinued = ["/products/glacier-0-mummy-bag-2023", "/products/trailhawk-tent-v1", "/products/summit-dome-3p-2022", "/products/voyager-80l-pack-2022"];
  const liveDiscontinued = version === 1 ? discontinued : discontinued.slice(0, 1);
  const pick = <T,>(list: T[], seed: string, n: number) => {
    const r = seeded(seed);
    return [...list].sort(() => r() - 0.5).slice(0, n);
  };

  pages.push({
    path: "/",
    kind: "home",
    title: "Northwind Outdoor: Hiking, Camping & Climbing Gear",
    h1: "Gear up for your next adventure",
    description: "Shop tents, sleeping bags, hiking boots, jackets and backpacks from Northwind Outdoor. Free shipping over $50 and 60-day returns.",
    words: 640,
    links: [...nav, ...products.slice(0, 40).filter((_, i) => i % 5 === 0).map((p) => p.path), ...posts.slice(-3).map((p) => p.path), "/guides", "/summer-sale"],
    schema: ["Organization", "WebSite"],
  });
  for (const [slug, name, names] of NW_COLLECTIONS) {
    const own = products.filter((p) => p.collection === slug).map((p) => p.path);
    const extra = liveDiscontinued.filter((u) => u.includes(slug === "tents" ? "tent" : slug === "sleeping-bags" ? "bag" : slug === "backpacks" ? "pack" : "@"));
    pages.push({
      path: `/collections/${slug}`,
      kind: "collection",
      title: `${name}${S}`,
      h1: name,
      description: `Shop ${name.toLowerCase()} for hiking, camping and the backcountry. Compare ${names.length * 6}+ styles, read reviews and get free shipping over $50.`,
      words: 320 + Math.round(unit(`nw-col-${slug}`) * 200),
      links: [...nav, ...own, ...extra, ...landing.filter((_, i) => i % NW_COLLECTIONS.length === NW_COLLECTIONS.findIndex((c) => c[0] === slug)).map((l) => l.path)],
      schema: ["CollectionPage", "BreadcrumbList"],
    });
  }
  for (const p of products) {
    const siblings = products.filter((q) => q.collection === p.collection && q.path !== p.path).map((q) => q.path);
    pages.push({
      path: p.path,
      kind: "product",
      title: `${p.name}${S}`,
      h1: p.name,
      description: `The ${p.name} is built for real trails: tested by our staff, backed by a lifetime warranty. Free shipping over $50 and 60-day returns.`,
      words: 380 + Math.round(unit(`nw-p-${p.path}`) * 420),
      links: [...nav, `/collections/${p.collection}`, ...siblings.slice(0, 4)],
      images: 6 + Math.round(unit(`nw-pi-${p.path}`) * 6),
      schema: ["Product", "BreadcrumbList"],
    });
  }
  landing.forEach((l, i) => {
    const kind = kindOf(l.path);
    const name = titleCase(l.phrase);
    pages.push({
      path: l.path,
      kind,
      title: kind === "guide" ? `${name}: The Complete Guide${S}` : `${name}${S}`,
      h1: kind === "guide" ? `${name}: the complete guide` : name,
      description: `Everything about ${l.phrase}: our picks, buying advice from the Northwind staff and the best deals on ${l.phrase} this season.`,
      words: kind === "guide" ? 1600 + Math.round(unit(`nw-g-${l.path}`) * 1400) : 520 + Math.round(unit(`nw-l-${l.path}`) * 600),
      links: [...nav, ...pick(products, `nw-lp-${i}`, 3).map((p) => p.path), kind === "guide" ? "/guides" : `/collections/${NW_COLLECTIONS[i % NW_COLLECTIONS.length][0]}`],
      schema: kind === "product" ? ["Product"] : kind === "guide" ? ["Article", "FAQPage"] : ["CollectionPage"],
    });
  });
  // Blog: an index with three pages of older posts (the oldest end up deep in the site).
  const sorted = [...posts].reverse();
  const listing = [sorted.slice(0, 8), sorted.slice(8, 14), sorted.slice(14, 19), sorted.slice(19)].filter((list, i) => i === 0 || list.length > 0);
  listing.forEach((list, i) => {
    const path = i === 0 ? "/blog" : `/blog?page=${i + 1}`;
    pages.push({
      path,
      kind: "listing",
      title: i === 0 ? `The Trail Journal: Hiking & Camping Tips${S}` : `The Trail Journal, Page ${i + 1}${S}`,
      h1: "The Trail Journal",
      description: `Trip reports, gear guides and how-tos from the Northwind Outdoor team${i ? ` (page ${i + 1})` : ""}. New stories every week.`,
      words: 260,
      links: [...nav, ...list.map((p) => p.path), ...(i < listing.length - 1 && listing[i + 1].length ? [`/blog?page=${i + 2}`] : [])],
      schema: ["Blog"],
      sitemap: i === 0,
    });
  });
  posts.forEach((p, i) => {
    const deadLink = i % 7 === 0 && (version === 1 || i === 0) ? liveDiscontinued[(i / 7) % liveDiscontinued.length] : undefined;
    pages.push({
      path: p.path,
      kind: "blog",
      title: `${p.title}${S}`,
      h1: p.title,
      description: `${p.title}: practical advice from the Northwind Outdoor team, with the gear we trust and the mistakes to avoid on the trail.`,
      words: 1100 + Math.round(unit(`nw-b-${p.path}`) * 1300),
      links: [...nav, ...pick(products, `nw-bp-${i}`, 2).map((q) => q.path), ...(deadLink ? [deadLink] : []), ...(version === 1 ? ["/old-catalog"] : [])],
      external: i % 5 === 0 ? ["https://www.nps.gov/subjects/camping/index.htm", ...(version === 1 && i % 10 === 0 ? ["https://trailmaps-archive.example/colorado"] : [])] : ["https://lnt.org/why/7-principles/"],
      images: 5 + Math.round(unit(`nw-bi-${p.path}`) * 5),
      schema: ["BlogPosting"],
    });
  });
  pages.push({ path: "/guides", kind: "listing", title: `Buying Guides${S}`, h1: "Buying guides", description: "Expert buying guides for tents, sleeping bags, boots, packs and layers, written by the people who test our gear on the trail.", words: 340, links: [...nav, ...landing.filter((l) => kindOf(l.path) === "guide").map((l) => l.path)], schema: ["CollectionPage"] });
  const info: Array<[string, string, string, number]> = [
    ["/about", "About Northwind Outdoor", "Since 2009 Northwind Outdoor has outfitted hikers and campers from three stores in the Pacific Northwest and the Rockies.", 720],
    ["/contact", "Contact Us", "Questions about an order, sizing or gear advice? Call, chat or email the Northwind Outdoor team, seven days a week.", 240],
    ["/shipping", "Shipping Information", "Free standard shipping on orders over $50 within the US. Orders placed before 2 pm ship the same day from Denver.", 410],
    ["/returns", "Returns & Exchanges", "Not right? Return unused gear within 60 days for a full refund or exchange, in store or by mail with a prepaid label.", 380],
    ["/faq", "Frequently Asked Questions", "Answers about orders, shipping, returns, warranties, gear rentals and our stores in Denver, Seattle and Portland.", 860],
    ["/gift-cards", "Gift Cards", "Northwind Outdoor gift cards never expire and can be used online and in all of our stores.", 150],
    ["/privacy-policy", "Privacy Policy", "How Northwind Outdoor collects, uses and protects your personal information when you shop with us.", 1500],
    ["/terms-of-service", "Terms of Service", "The terms that apply when you use northwindoutdoor.example and buy from Northwind Outdoor.", 1700],
    ["/careers", "Careers", "Join the Northwind Outdoor crew: open roles in our stores, warehouse and Denver head office.", 420],
    ["/brands", "Brands We Carry", "Browse the outdoor brands carried by Northwind Outdoor, from our own trail-tested line to the names you know.", 300],
    ["/sale", "Sale: Up to 40% Off Outdoor Gear", "Last season's tents, jackets, boots and packs at up to 40% off while stock lasts. New markdowns every Friday.", 280],
    ["/stores", "Our Stores", "Visit Northwind Outdoor in Denver, Seattle and Portland for fittings, rentals, repairs and free clinics.", 300],
  ];
  for (const [path, title, description, words] of info) {
    const isStores = path === "/stores";
    const schema = isStores || path === "/about" || path === "/contact" ? ["Organization"] : path === "/faq" ? ["FAQPage"] : path === "/sale" ? ["CollectionPage"] : [];
    pages.push({ path, kind: "info", title: path === "/gift-cards" && version === 1 ? "" : `${title}${S}`, h1: title, description, words, links: [...nav, ...(isStores ? ["/stores/denver", "/stores/seattle", "/stores/portland"] : [])], schema });
  }
  for (const [city, state] of [["Denver", "Colorado"], ["Seattle", "Washington"], ["Portland", "Oregon"]]) {
    pages.push({
      path: `/stores/${city.toLowerCase()}`,
      kind: "info",
      title: `Outdoor Gear Store in ${city}, ${state}${S}`,
      h1: `Northwind Outdoor ${city}`,
      description: `Visit our ${city} store for hiking, camping and climbing gear, boot fittings, rentals and repairs. Open daily, free parking.`,
      words: 450,
      links: [...nav, "/stores"],
      schema: ["LocalBusiness"],
    });
  }
  for (const path of liveDiscontinued) pages.push({ path, kind: "missing", title: "", h1: "", description: "", words: 0, links: [], status: 404, sitemap: version === 1 });
  pages.push({ path: "/summer-sale", kind: "redirect", title: "", h1: "", description: "", words: 0, links: [], hops: ["/sale-2025", "/sale"] });
  if (version === 1) pages.push({ path: "/old-catalog", kind: "redirect", title: "", h1: "", description: "", words: 0, links: [], hops: ["/collections/tents"] });
  // Old campaign pages still in the sitemap but no longer linked.
  for (const [path, title] of version === 1 ? [["/black-friday-2025", "Black Friday Deals"], ["/holiday-gift-guide", "Holiday Gift Guide"]] : [["/holiday-gift-guide", "Holiday Gift Guide"]]) {
    pages.push({ path, kind: "landing", title: `${title}${S}`, h1: title, description: `${title} from Northwind Outdoor: our favorite gear for the hikers and campers on your list, at the best prices of the year.`, words: 520, links: nav });
  }

  const rates: DefectRates =
    version === 1
      ? { metaMissing: 0.17, metaShort: 0.03, metaLong: 0.05, titleLong: 0.1, titleDup: 0.08, metaDup: 0.05, h1Missing: 0.05, h1Multiple: 0.04, altMissing: 0.2, thin: 0.09, canonicalMissing: 0.15, ogMissing: 0.12, twitterMissing: 0.2, noSchema: 0.08, slow: 0.07 }
      : { metaMissing: 0.09, metaShort: 0.02, metaLong: 0.04, titleLong: 0.09, titleDup: 0.03, metaDup: 0.02, h1Missing: 0.02, h1Multiple: 0.03, altMissing: 0.14, thin: 0.05, canonicalMissing: 0.06, ogMissing: 0.05, twitterMissing: 0.15, noSchema: 0.06, slow: 0.04 };
  return {
    pages,
    rates,
    mixed: version === 1 ? products.slice(0, 40).filter((_, i) => i % 13 === 4).map((p) => p.path) : [],
    // The first audit caught a slow product template (fixed since); new posts lack alt text.
    forced:
      version === 2
        ? { altMissing: newPosts.slice(0, 3).map((t) => `/blog/${slugify(t)}`), metaMissing: [`/blog/${slugify(newPosts[3])}`] }
        : { slow: products.filter((_, i) => i % 7 === 3).map((p) => p.path) },
    externalStatus: new Map<string, number | null>([
      ["https://www.nps.gov/subjects/camping/index.htm", 200],
      ["https://lnt.org/why/7-principles/", 200],
      ["https://trailmaps-archive.example/colorado", 404],
    ]),
    facts: { httpRedirectsToHttps: version === 2 },
    lang: "en",
    dupTitle: "Northwind Outdoor: Outdoor Gear & Camping Equipment",
    dupDescription: "Northwind Outdoor sells outdoor gear and camping equipment online and in stores. Free shipping over $50.",
    brandSuffix: S,
  };
}

function acmeSite(plans: KeywordPlan[], version: 1 | 2): SiteBuild {
  const S = " | Acme Cloud";
  const pages: PageDef[] = [];
  const header = ["/", "/features", "/pricing", "/solutions/small-business", "/integrations", "/customers", "/blog", "/security"];
  const footer = ["/about", "/careers", "/contact", "/legal/privacy", "/legal/terms", "/legal/dpa", "/login", "/signup"];
  const nav = [...header, ...footer];
  const ranked = rankingPages(plans, ACME_DOMAIN);
  const features = ["File Sync", "Backup", "Object Storage", "Versioning", "Sharing Links", "Encryption", "Admin Console", "API"];
  const solutions = ["Small Business", "Agencies", "Healthcare", "Education", "Developers"];
  const integrations = ["Slack", "Microsoft 365", "Google Workspace", "Zapier", "Okta", "Synology"];
  pages.push({
    path: "/",
    kind: "home",
    title: "Acme Cloud: Secure Cloud Storage & Backup for Teams",
    h1: "Your team's files, safe and in sync",
    description: "Acme Cloud is encrypted cloud storage, backup and file sharing for growing teams. S3-compatible, GDPR-ready, from $6 per user.",
    words: 820,
    links: [...nav, ...features.map((f) => `/features/${slugify(f)}`), ...solutions.map((x) => `/solutions/${slugify(x)}`), "/compare/dropbox", "/compare/google-drive", "/compare/box"],
    schema: ["Organization", "SoftwareApplication"],
  });
  pages.push({ path: "/pricing", kind: "info", title: `Pricing${S}`, h1: "Simple pricing for every team", description: "Acme Cloud plans start at $6 per user per month with 1 TB each. Compare Team, Business and Enterprise; 14-day free trial.", words: 760, links: nav, schema: ["Product", "FAQPage"] });
  pages.push({ path: "/features", kind: "listing", title: `Features${S}`, h1: "Everything your files need", description: "Sync, backup, object storage, versioning, sharing and admin controls: every Acme Cloud feature in one place.", words: 540, links: [...nav, ...features.map((f) => `/features/${slugify(f)}`)] });
  for (const f of features) {
    pages.push({ path: `/features/${slugify(f)}`, kind: "landing", title: `${f} for Business Teams${S}`, h1: f, description: `${f} in Acme Cloud: how it works, what it costs and how teams use it to keep their files safe and easy to find.`, words: 640 + Math.round(unit(`ac-f-${f}`) * 500), links: [...nav, "/features", "/pricing"], schema: ["WebPage"] });
  }
  for (const s of solutions) {
    pages.push({ path: `/solutions/${slugify(s)}`, kind: "landing", title: `Cloud Storage for ${s}${S}`, h1: `Acme Cloud for ${s.toLowerCase()}`, description: `Why ${s.toLowerCase()} choose Acme Cloud for file storage, backup and sharing: compliance, admin controls and predictable pricing.`, words: 700, links: [...nav, "/pricing", "/customers"] });
  }
  pages.push({ path: "/integrations", kind: "listing", title: `Integrations${S}`, h1: "Integrations", description: "Connect Acme Cloud to Slack, Microsoft 365, Google Workspace, Zapier, Okta and your NAS in a few clicks.", words: 380, links: [...nav, ...integrations.map((i) => `/integrations/${slugify(i)}`)] });
  for (const i of integrations) {
    pages.push({ path: `/integrations/${slugify(i)}`, kind: "landing", title: `${i} Integration${S}`, h1: `Acme Cloud + ${i}`, description: `Use Acme Cloud with ${i}: share files, back up data and manage access without leaving the tools your team already uses.`, words: 480, links: [...nav, "/integrations"] });
  }
  for (const c of ["Dropbox", "Google Drive", "Box"]) {
    pages.push({ path: `/compare/${slugify(c)}`, kind: "landing", title: `Acme Cloud vs ${c}${S}`, h1: `Acme Cloud vs ${c}`, description: `Acme Cloud vs ${c}: storage, security, pricing and admin features compared side by side for business teams.`, words: 1400, links: [...nav, "/pricing"], schema: ["Article"] });
  }
  const stories = ["Brightline Architects", "Harbor Health Clinic", "Pixel & Pine Studio", "Northgate Schools"];
  pages.push({ path: "/customers", kind: "listing", title: `Customer Stories${S}`, h1: "Teams that trust Acme Cloud", description: "How architects, clinics, agencies and schools store, share and back up their files with Acme Cloud.", words: 420, links: [...nav, ...stories.map((s) => `/customers/${slugify(s)}`)] });
  for (const s of stories) pages.push({ path: `/customers/${slugify(s)}`, kind: "blog", title: `${s} Case Study${S}`, h1: `How ${s} moved to Acme Cloud`, description: `${s} replaced their file server with Acme Cloud: faster sharing, nightly backups and no more VPN for remote staff.`, words: 900, links: [...nav, "/customers"], schema: ["Article"] });
  const posts = ranked.map((r) => ({ path: r.path, title: titleCase(r.phrase) }));
  const newPosts = version === 2 ? ["Backup Checklist for Small Teams", "What Changed in Our 2026 Pricing"] : [];
  const allPosts = [...posts, ...newPosts.map((t) => ({ path: `/blog/${slugify(t)}`, title: t }))];
  pages.push({ path: "/blog", kind: "listing", title: `Blog${S}`, h1: "The Acme Cloud blog", description: "Guides on cloud storage, backup strategy, security and compliance for small and growing teams.", words: 300, links: [...nav, ...allPosts.map((p) => p.path)], schema: ["Blog"] });
  allPosts.forEach((p, i) => {
    pages.push({
      path: p.path,
      kind: kindOf(p.path) === "blog" ? "blog" : "landing",
      title: `${p.title}${S}`,
      h1: p.title,
      description: `${p.title}: a practical guide for small teams from Acme Cloud, with examples, costs and a checklist you can use today.`,
      words: 900 + Math.round(unit(`ac-b-${p.path}`) * 1200),
      links: [...nav, "/pricing", ...(i % 4 === 0 && (version === 1 || i === 0) ? ["/features/old-backup"] : [])],
      external: i % 3 === 0 ? ["https://gdpr.eu/what-is-gdpr/"] : [],
      schema: ["BlogPosting"],
    });
  });
  const info: Array<[string, string, string, number]> = [
    ["/security", "Security & Compliance", "Encryption at rest and in transit, SOC 2 Type II, GDPR and HIPAA options, and data centers in the US and the EU.", 980],
    ["/about", "About Us", "Acme Cloud was founded in 2016 to give small teams the storage and backup tools big companies take for granted.", 520],
    ["/careers", "Careers", "Work on storage infrastructure used by 40,000 teams. Remote-first, with hubs in Austin and London.", 460],
    ["/contact", "Contact Sales", "Talk to the Acme Cloud team about plans, migrations, security reviews or a custom quote for your organisation.", 220],
    ["/legal/privacy", "Privacy Policy", "How Acme Cloud handles personal data, which sub-processors we use and how to exercise your rights.", 2100],
    ["/legal/terms", "Terms of Service", "The terms of service that apply to every Acme Cloud plan.", 2600],
    ["/legal/dpa", "Data Processing Agreement", "The Acme Cloud data processing agreement for customers subject to the GDPR and the UK GDPR.", 1900],
    ["/signup", "Start Your Free Trial", "Try Acme Cloud free for 14 days: no credit card, 1 TB per user, every feature included.", 160],
  ];
  for (const [path, title, description, words] of info) pages.push({ path, kind: "info", title: `${title}${S}`, h1: title, description, words, links: nav, schema: [] });
  pages.push({ path: "/login", kind: "noindex", title: `Log In${S}`, h1: "Log in to Acme Cloud", description: "Log in to your Acme Cloud account.", words: 40, links: ["/", "/signup"], sitemap: false });
  pages.push({ path: "/features/old-backup", kind: "missing", title: "", h1: "", description: "", words: 0, links: [], status: 404, sitemap: false });
  const rates: DefectRates =
    version === 1
      ? { metaMissing: 0.1, metaShort: 0.04, metaLong: 0.05, titleLong: 0.1, titleDup: 0.05, metaDup: 0.04, h1Missing: 0.04, h1Multiple: 0.04, altMissing: 0.16, thin: 0.06, canonicalMissing: 0.15, ogMissing: 0.12, twitterMissing: 0.2, noSchema: 0.1, slow: 0.08 }
      : { metaMissing: 0.06, metaShort: 0.03, metaLong: 0.04, titleLong: 0.08, titleDup: 0.03, metaDup: 0.03, h1Missing: 0.02, h1Multiple: 0.03, altMissing: 0.12, thin: 0.05, canonicalMissing: 0.06, ogMissing: 0.07, twitterMissing: 0.15, noSchema: 0.08, slow: 0.06 };
  return {
    pages,
    rates,
    mixed: [],
    forced: version === 2 ? { altMissing: newPosts.map((t) => `/blog/${slugify(t)}`) } : {},
    externalStatus: new Map([["https://gdpr.eu/what-is-gdpr/", 200]]),
    facts: {},
    lang: "en",
    dupTitle: "Acme Cloud: Cloud Storage, Backup and File Sharing",
    dupDescription: "Acme Cloud offers secure cloud storage, backup and file sharing for business teams of every size.",
    brandSuffix: S,
  };
}

const BEANS = ["Éthiopie Guji", "Colombie Huila", "Brésil Cerrado", "Kenya Nyeri", "Décaféiné Mexique"];

function cafeSite(plans: KeywordPlan[]): SiteBuild {
  const S = " | Café Lumière";
  const pages: PageDef[] = [];
  const nav = ["/", "/carte", "/brunch", "/boutique", "/evenements", "/a-propos", "/contact", "/reservation", "/journal"];
  const ranked = rankingPages(plans, CAFE_DOMAIN);
  pages.push({ path: "/", kind: "home", title: "Café Lumière : café de spécialité et brunch à Paris 11e", h1: "Café de spécialité, brunch et pâtisseries maison", description: "Café Lumière, rue Oberkampf à Paris 11e : café de spécialité torréfié sur place, brunch le week-end et wifi gratuit.", words: 480, links: nav, schema: ["CafeOrCoffeeShop"] });
  const info: Array<[string, string, string, number]> = [
    ["/carte", "La carte", "Espresso, filtre, chocolat chaud, thés bio et pâtisseries maison : toute la carte du Café Lumière avec les prix.", 380],
    ["/brunch", "Brunch du week-end", "Le brunch du Café Lumière, samedi et dimanche de 10 h à 15 h : formule à 26 €, options végétariennes et sans gluten.", 420],
    ["/boutique", "Boutique : cafés en grains", "Nos cafés de spécialité torréfiés chaque semaine à Paris, en grains ou moulus, à emporter ou livrés chez vous.", 300],
    ["/evenements", "Ateliers et événements", "Ateliers latte art, dégustations et soirées privées au Café Lumière. Réservez votre place en ligne.", 260],
    ["/a-propos", "Notre histoire", "Ouvert en 2018 par deux baristas passionnés, le Café Lumière torréfie ses cafés sur place au cœur du 11e.", 540],
    ["/contact", "Contact et accès", "Café Lumière, 54 rue Oberkampf, 75011 Paris. Métro Parmentier. Ouvert tous les jours de 8 h à 19 h.", 160],
    ["/reservation", "Réserver une table", "Réservez une table pour le brunch ou un groupe au Café Lumière, en ligne et sans frais.", 120],
    ["/mentions-legales", "Mentions légales", "Mentions légales du site du Café Lumière.", 400],
  ];
  for (const [path, title, description, words] of info) pages.push({ path, kind: "info", title: `${title}${S}`, h1: title, description, words, links: path === "/boutique" ? [...nav, ...BEANS.map((b) => `/boutique/${slugify(b)}`)] : nav, schema: [] });
  for (const b of BEANS) pages.push({ path: `/boutique/${slugify(b)}`, kind: "product", title: `${b}, café de spécialité${S}`, h1: b, description: `${b} : notes de dégustation, origine et conseils d'extraction. Torréfié à Paris, expédié sous 48 h.`, words: 260, links: [...nav, "/boutique"], schema: ["Product"] });
  const posts = ranked.map((r) => ({ path: r.path, title: titleCase(r.phrase) }));
  pages.push({ path: "/journal", kind: "listing", title: `Le journal${S}`, h1: "Le journal", description: "Recettes, origines et nouvelles du Café Lumière.", words: 180, links: [...nav, ...posts.map((p) => p.path)] });
  for (const p of posts) pages.push({ path: p.path, kind: kindOf(p.path) === "blog" ? "blog" : "landing", title: `${p.title}${S}`, h1: p.title, description: `${p.title} : nos conseils et adresses préférées à Paris, par l'équipe du Café Lumière.`, words: 650, links: [...nav, "/journal"], schema: ["BlogPosting"] });
  return {
    pages,
    rates: { metaMissing: 0.12, metaShort: 0.08, metaLong: 0.06, titleLong: 0.2, titleDup: 0.04, metaDup: 0.04, h1Missing: 0.05, h1Multiple: 0.05, altMissing: 0.25, thin: 0.1, canonicalMissing: 0.4, ogMissing: 0.3, twitterMissing: 0.6, noSchema: 0.15, slow: 0.05 },
    mixed: [],
    forced: {},
    externalStatus: new Map(),
    facts: { sitemap: { found: false, valid: false, urls: 0 }, robotsTxt: { found: true, valid: true, disallowAll: false, sitemaps: [] }, robotsText: "User-agent: *\nDisallow:\n" },
    lang: "fr",
    dupTitle: "Café Lumière : café et brunch à Paris",
    dupDescription: "Café Lumière, café de spécialité et brunch à Paris 11e.",
    brandSuffix: S,
  };
}

// ── The seed ──

export async function seedDemoProjects(trx: Db, { adminId, rand }: { adminId: number; rand: Rand }): Promise<void> {
  const started = Date.now();
  const nowMs = started;
  const iso = (ms: number) => new Date(ms).toISOString();
  const counts: Record<string, number> = {};
  const count = (table: string, n: number) => (counts[table] = (counts[table] ?? 0) + n);

  // The demo's rank checks read 100 results, so deeper positions show up as well.
  await upsertSetting(trx, "serp_depth", String(DEPTH), true);

  const channel = await trx
    .insertInto("alert_channels")
    .values({ user_id: adminId, type: "email", name: "SEO team", config: JSON.stringify({ to: "seo@northwindoutdoor.example" }), is_active: 1, created_at: iso(nowMs - 96 * DAY), updated_at: iso(nowMs - 96 * DAY) })
    .executeTakeFirstOrThrow();
  const channelId = Number(channel.insertId);
  count("alert_channels", 1);

  const specs: ProjectSpec[] = [
    {
      key: "northwind",
      ownerId: adminId,
      name: "Northwind Outdoor",
      domain: NW_DOMAIN,
      createdDaysAgo: 95,
      days: HISTORY_DAYS,
      frequency: "daily",
      extraDays: GSC_LAG,
      settings: {
        competitors: ["trailpeak.example", "summitgear.example", "basecampsupply.example"],
        alertRules: [
          { type: "enters_top", top: 3 },
          { type: "change", min: 5 },
        ],
        alertChannelIds: [channelId],
        alertOnAudit: true,
        report: { companyName: "Northwind Outdoor", logo: "", color: "#2f6f4e" },
      },
      keywords: NORTHWIND_KEYWORDS,
      // An SEO campaign: every keyword was a few places (and deeper ones many places) lower three months ago.
      story: (ago, pos) => (3 + 0.8 * pos) * Math.min(1, ago / (HISTORY_DAYS - 2)) ** 1.5,
    },
    {
      key: "acme",
      ownerId: adminId,
      name: "Acme Cloud",
      domain: ACME_DOMAIN,
      createdDaysAgo: 93,
      days: HISTORY_DAYS,
      frequency: "daily",
      extraDays: GSC_LAG,
      settings: { competitors: ["cloudnimbus.example", "stratovault.example"] },
      keywords: ACME_KEYWORDS,
      // A core update about two months ago, then a recovery over four weeks.
      story: (ago, pos) => {
        const hit = ago > 62 ? 0 : ago > 56 ? (62 - ago) / 6 : ago > 40 ? 1 : ago > 12 ? (ago - 12) / 28 : 0;
        return (3 + 0.5 * pos) * smooth(hit);
      },
    },
    {
      key: "cafe",
      ownerId: adminId,
      name: "Café Lumière",
      domain: CAFE_DOMAIN,
      createdDaysAgo: 92,
      days: HISTORY_DAYS,
      frequency: "daily",
      settings: { country: "FR", language: "fr", device: "mobile", location: "Paris", competitors: ["cafe-oberkampf.example", "brulerie-bastille.example"] },
      keywords: CAFE_KEYWORDS,
      story: (ago, pos) => (1 + 0.2 * pos) * (ago / HISTORY_DAYS),
    },
  ];

  // The three longest-standing sample customers with a paid plan get a small project each
  // (created after they signed up, with up to 30 days of history).
  const customers = await trx
    .selectFrom("users")
    .innerJoin("plans", "plans.id", "users.plan_id")
    .select(["users.id", "users.created_at", "plans.check_frequency"])
    .where("users.role", "=", "user")
    .where("users.status", "=", "active")
    .where("users.plan_expires_at", ">", iso(nowMs))
    .orderBy("users.created_at")
    .orderBy("users.id")
    .limit(CUSTOMER_PROJECTS.length)
    .execute();
  customers.forEach((c, i) => {
    const p = CUSTOMER_PROJECTS[i];
    const days = Math.max(7, Math.min(CUSTOMER_DAYS, Math.floor((nowMs - Date.parse(c.created_at)) / DAY) - 2));
    specs.push({
      key: `customer${i}`,
      ownerId: c.id,
      name: p.name,
      domain: p.domain,
      createdDaysAgo: days + 1,
      days,
      frequency: c.check_frequency === "weekly" ? "weekly" : "daily",
      settings: p.settings,
      keywords: p.keywords,
    });
  });

  const shareToken = randomToken(24);
  const projects: Array<{ spec: ProjectSpec; id: number; settings: ProjectSettings; plans: KeywordPlan[]; keywordIds: number[] }> = [];
  for (const spec of specs) {
    const settings = normalizeProjectSettings({ ...DEFAULT_PROJECT_SETTINGS, checkFrequency: spec.frequency, ...spec.settings }, spec.domain);
    const plans = planKeywords(spec, settings, nowMs);
    const created = iso(nowMs - spec.createdDaysAgo * DAY);
    const res = await trx
      .insertInto("projects")
      .values({
        user_id: spec.ownerId,
        name: spec.name,
        domain: spec.domain,
        settings: JSON.stringify(settings),
        status: "active",
        share_token: spec.key === "northwind" ? shareToken : null,
        gsc_property: spec.key === "northwind" || spec.key === "acme" ? `sc-domain:${spec.domain}` : null,
        gsc_connection_id: null,
        created_at: created,
        updated_at: created,
      })
      .executeTakeFirstOrThrow();
    const projectId = Number(res.insertId);
    count("projects", 1);

    const keywordCreated = iso(nowMs - spec.createdDaysAgo * DAY + 20 * MIN);
    const keywordRows = plans.map((p) => {
      const last = p.history[p.history.length - 1];
      const ranked = p.history.filter((h) => h.position !== null);
      const target = p.spec.target === "ranking" ? (last.url ?? `https://${spec.domain}/${slugify(p.phrase)}`) : p.spec.target ? `https://${spec.domain}${p.spec.target}` : null;
      return {
        project_id: projectId,
        phrase: p.phrase,
        country: p.country,
        language: p.language,
        device: p.device,
        location: p.location,
        dedupe_key: sha256(keywordIdentity({ phrase: p.phrase, country: p.country, language: p.language, device: p.device, location: p.location })),
        tags: JSON.stringify(normalizeTags(p.spec.tags)),
        target_url: target,
        status: "active" as const,
        last_checked_at: last.checkedAt,
        last_position: last.position,
        best_position: ranked.length ? Math.min(...ranked.map((h) => h.position!)) : null,
        start_position: ranked[0]?.position ?? null,
        last_url: last.url,
        last_features: JSON.stringify(last.features),
        next_check_at: nextCheckAt(spec.frequency, last.checkedAt),
        fail_count: 0,
        last_error: null,
        created_at: keywordCreated,
        updated_at: last.checkedAt,
      };
    });
    count("keywords", await insertChunked(trx, "keywords", keywordRows));
    const ids = await trx.selectFrom("keywords").select(["id", "dedupe_key"]).where("project_id", "=", projectId).execute();
    const idByKey = new Map(ids.map((r) => [r.dedupe_key, r.id]));
    const keywordIds = keywordRows.map((k) => idByKey.get(k.dedupe_key)!);

    const rankingRows = plans.flatMap((p, i) =>
      p.history.map((h) => ({
        keyword_id: keywordIds[i],
        project_id: projectId,
        day: h.day,
        position: h.position,
        url: h.url,
        features: JSON.stringify(h.features),
        competitors: JSON.stringify(h.competitors),
        provider: "simulated",
        checked_at: h.checkedAt,
        alerts: null,
      })),
    );
    count("rankings", await insertChunked(trx, "rankings", rankingRows, 500));
    const snapshots = plans.map((p, i) => ({ keyword_id: keywordIds[i], checked_at: p.history[p.history.length - 1].checkedAt, results: JSON.stringify(p.results) }));
    count("serp_snapshots", await insertChunked(trx, "serp_snapshots", snapshots, 100));
    projects.push({ spec, id: projectId, settings, plans, keywordIds });
  }

  // Site audits: two for Northwind and Acme (a month ago and last week), one for the café.
  const audits: Array<{ projectId: number; ownerId: number; audit: StoredAudit }> = [];
  const nw = projects.find((p) => p.spec.key === "northwind")!;
  const acme = projects.find((p) => p.spec.key === "acme")!;
  const cafe = projects.find((p) => p.spec.key === "cafe")!;
  const auditAt = (daysAgo: number, hour: number) => {
    const day = dayOf(nowMs - daysAgo * DAY);
    return Date.parse(`${day}T${String(hour).padStart(2, "0")}:12:00.000Z`);
  };
  const nw1 = await storeAudit(trx, nw.id, NW_DOMAIN, northwindSite(nw.plans, 1), "northwind", auditAt(30, 9), null);
  const nw2 = await storeAudit(trx, nw.id, NW_DOMAIN, northwindSite(nw.plans, 2), "northwind", auditAt(5, 8), nw1);
  const ac1 = await storeAudit(trx, acme.id, ACME_DOMAIN, acmeSite(acme.plans, 1), "acme", auditAt(31, 14), null);
  const ac2 = await storeAudit(trx, acme.id, ACME_DOMAIN, acmeSite(acme.plans, 2), "acme", auditAt(6, 15), ac1);
  const cf1 = await storeAudit(trx, cafe.id, CAFE_DOMAIN, cafeSite(cafe.plans), "cafe", auditAt(12, 10), null);
  for (const [p, a] of [[nw, nw1], [nw, nw2], [acme, ac1], [acme, ac2], [cafe, cf1]] as const) {
    audits.push({ projectId: p.id, ownerId: p.spec.ownerId, audit: a });
    count("audits", 1);
    count("audit_pages", a.pages);
    count("audit_issues", a.issues);
  }

  // Search Console (demo data: gsc_connection_id stays NULL, so the import job leaves it alone).
  const gscRows = [
    ...buildGsc(nw.id, NW_DOMAIN, nw.plans, {
      queries: 14,
      pages: 6,
      weekly: [1.2, 0.94, 0.9, 0.92, 0.97, 1.04, 1.24],
      growth: 0.14,
      tail: { impressions: 0.9, clicks: 0.45, position: 23 },
      extraPages: ["/collections/tents", "/collections/hiking-boots", "/collections/jackets", "/collections/sleeping-bags", "/stores/denver", "/sale"],
    }, rand, nowMs),
    ...buildGsc(acme.id, ACME_DOMAIN, acme.plans, {
      queries: 9,
      pages: 5,
      weekly: [0.62, 1.1, 1.14, 1.12, 1.08, 0.97, 0.58],
      growth: 0.08,
      tail: { impressions: 1.1, clicks: 0.5, position: 26 },
      extraPages: ["/pricing", "/features", "/security", "/compare/dropbox"],
    }, rand, nowMs),
  ];
  count("gsc_daily", await insertChunked(trx, "gsc_daily", gscRows, 500));

  // Weekly client report and its history, the public report link for the landing page.
  const lastMonday = nextMonday(nowMs) - 7 * DAY;
  await trx
    .insertInto("report_schedules")
    .values({
      project_id: nw.id,
      frequency: "weekly",
      recipients: "client@northwind.example, marketing@northwind.example",
      is_active: 1,
      last_sent_at: lastMonday > nowMs - 90 * DAY ? iso(lastMonday + 40_000) : null,
      next_send_at: iso(nextMonday(nowMs)),
      created_at: iso(nowMs - 80 * DAY),
      updated_at: iso(lastMonday + 40_000),
    })
    .execute();
  count("report_schedules", 1);
  await upsertSetting(trx, "showcase_report_token", shareToken);

  // Alert history: the rank alerts Northwind's rules fired lately, audit and report emails.
  const log: Array<Insertable<Database["alert_log"]>> = [];
  // Top-N alerts are logged with their threshold ("rank_entered_top:3"), as notifyChannels does.
  const logRow = (projectId: number, chan: number | null, event: AlertEvent | "report_sent" | `${AlertEvent}:${number}`, at: number) =>
    log.push({ project_id: projectId, channel_id: chan, event, ok: 1, error: null, created_at: iso(at) });
  const hits: Array<{ event: AlertEvent | `${AlertEvent}:${number}`; at: number }> = [];
  for (const p of nw.plans) {
    for (let i = 1; i < p.history.length; i++) {
      const prev = p.history[i - 1];
      const cur = p.history[i];
      if (cur.daysAgo > 14 || cur.daysAgo === 0 || cur.position === null) continue;
      const at = Date.parse(cur.checkedAt) + 25_000;
      if (cur.position <= 3 && (prev.position === null || prev.position > 3)) hits.push({ event: "rank_entered_top:3", at });
      else if (prev.position !== null && Math.abs(prev.position - cur.position) >= 5 && cur.position <= 30) hits.push({ event: "rank_changed", at });
    }
  }
  for (const h of hits.sort((a, b) => b.at - a.at).slice(0, 12)) logRow(nw.id, channelId, h.event, h.at);
  logRow(nw.id, channelId, "audit_finished", Date.parse(nw1.finishedAt) + 5000);
  logRow(nw.id, channelId, "audit_finished", Date.parse(nw2.finishedAt) + 5000);
  for (let week = 0; week < 4; week++) {
    const at = lastMonday - week * 7 * DAY + 40_000;
    if (at > nowMs - 80 * DAY && at < nowMs) logRow(nw.id, null, "report_sent", at);
  }
  log.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  count("alert_log", await insertChunked(trx, "alert_log", log));

  // Usage counters as the checks and audits would have left them (one request per check).
  const usage = new Map<string, { user_id: number; month: string; serp_requests: number; audit_pages: number; audits: number }>();
  const bump = (userId: number, at: string, field: "serp_requests" | "audit_pages" | "audits", n: number) => {
    const month = at.slice(0, 7);
    const k = `${userId}|${month}`;
    const row = usage.get(k) ?? { user_id: userId, month, serp_requests: 0, audit_pages: 0, audits: 0 };
    row[field] += n;
    usage.set(k, row);
  };
  const perDay = new Map<string, number>();
  for (const p of projects) {
    for (const plan of p.plans) {
      for (const h of plan.history) {
        bump(p.spec.ownerId, h.checkedAt, "serp_requests", 1);
        perDay.set(h.day, (perDay.get(h.day) ?? 0) + 1);
      }
    }
  }
  for (const a of audits) {
    bump(a.ownerId, a.audit.finishedAt, "audits", 1);
    bump(a.ownerId, a.audit.finishedAt, "audit_pages", a.audit.pages);
  }
  count("usage_monthly", await insertChunked(trx, "usage_monthly", [...usage.values()]));
  const providerRows = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, requests]) => ({ provider: "simulated", day, requests, errors: 0, credits: 0 }));
  count("provider_usage", await insertChunked(trx, "provider_usage", providerRows, 500));

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const scores = audits.map((a) => a.audit.score).join("/");
  console.log(`[searchzen] demo projects: ${total} rows in ${Date.now() - started} ms (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}; audit scores ${scores})`);
}
