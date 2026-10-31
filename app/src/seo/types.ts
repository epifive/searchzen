/**
 * The Searchzen contract: shared by the rank tracker (src/lib/serp), the site audit crawler
 * (src/lib/audit), Search Console import, reports, the dashboard, the REST API, the background
 * jobs, the alert channels and the SEO health badge (src/badge → public/sz-badge.js).
 *
 * Keep this file free of imports and runtime dependencies: it is used on the server, in client
 * components and (types only) in the badge script.
 *
 * Conventions:
 * - positions are 1-based organic ranks; `null` = not found within the checked depth
 * - countries are ISO 3166-1 alpha-2 in upper case ("US"); Google's `gl` is the lower-case form
 * - languages are ISO 639-1 ("en"), optionally with a region ("pt-BR"); Google's `hl`
 * - days are UTC "YYYY-MM-DD" strings, times ISO-8601 strings
 */

// ── Projects ──

export const DEVICES = ["desktop", "mobile"] as const;
export type Device = (typeof DEVICES)[number];

/** How often keywords are checked (a plan sets the fastest one allowed). */
export const CHECK_FREQUENCIES = ["weekly", "daily"] as const;
export type CheckFrequency = (typeof CHECK_FREQUENCIES)[number];

export const AUDIT_SCHEDULES = ["off", "weekly", "monthly"] as const;
export type AuditSchedule = (typeof AUDIT_SCHEDULES)[number];

/**
 * User agent of the crawler: "bot" = "SearchzenBot/1.0 (+site URL)", honest and recommended;
 * "browser" = a desktop Chrome user agent for sites that block unknown bots. robots.txt rules
 * for "SearchzenBot" (or "*") are followed either way.
 */
export const USER_AGENT_MODES = ["bot", "browser"] as const;
export type UserAgentMode = (typeof USER_AGENT_MODES)[number];

export const PROJECT_STATUSES = ["active", "paused"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Tops used by the "enters / leaves the top N" alert rules. */
export const ALERT_TOPS = [3, 10, 100] as const;
export type AlertTop = (typeof ALERT_TOPS)[number];

/**
 * Rank alert rules of a project (checked by the rank job after each check, fired once per
 * change, never twice for the same day):
 * - enters_top: the keyword moves into the top N (was outside or not ranked)
 * - leaves_top: the keyword drops out of the top N (now outside or not ranked)
 * - change: the position moved by at least `min` places, up or down (1–100)
 * - url_lost: the target URL no longer ranks (another URL or nothing ranks instead)
 */
export type AlertRule = { type: "enters_top"; top: AlertTop } | { type: "leaves_top"; top: AlertTop } | { type: "change"; min: number } | { type: "url_lost" };
export const ALERT_RULE_TYPES = ["enters_top", "leaves_top", "change", "url_lost"] as const;
export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

/** Report branding (custom logo / colour / company need the plan's white-label option). */
export interface ReportBranding {
  /** Company name shown on reports ("" = the project name). */
  companyName: string;
  /** Logo URL or upload path ("" = none). */
  logo: string;
  /** Accent colour #rrggbb ("" = platform colour). */
  color: string;
}

/** Stored as JSON in projects.settings; always read through normalizeProjectSettings(). */
export interface ProjectSettings {
  /** Defaults for new keywords. */
  country: string;
  language: string;
  device: Device;
  /** Optional city / region for new keywords ("" = whole country). */
  location: string;
  /** Competitor domains whose positions are recorded with every check (up to 5). */
  competitors: string[];
  /** Wanted check frequency (capped by the plan: a weekly plan checks weekly). */
  checkFrequency: CheckFrequency;
  auditSchedule: AuditSchedule;
  /** Pages per audit; 0 = the plan's maximum (also capped by it). */
  auditPageLimit: number;
  /** Pause between two requests of the crawler, ms (0–10,000). */
  crawlDelayMs: number;
  /** Only crawl URLs whose path starts with / matches one of these ("*" wildcard); empty = all. */
  includePatterns: string[];
  /** Never crawl URLs whose path matches one of these ("*" wildcard). */
  excludePatterns: string[];
  userAgent: UserAgentMode;
  /** Rank alert rules (up to 10). */
  alertRules: AlertRule[];
  /** Alert channels (alert_channels ids of the owner) that receive rank and audit alerts. */
  alertChannelIds: number[];
  /** Send an alert when an audit finishes (score and new issues). */
  alertOnAudit: boolean;
  report: ReportBranding;
  /** scrypt hash of the share-link password ("" = no password). The token is projects.share_token. */
  sharePasswordHash: string;
}

/** Crawl settings snapshot stored with an audit (audits.settings JSON). */
export interface CrawlSettings {
  startUrl: string;
  pageLimit: number;
  maxDepth: number;
  crawlDelayMs: number;
  includePatterns: string[];
  excludePatterns: string[];
  userAgent: UserAgentMode;
}

// ── Keywords and rankings ──

export const KEYWORD_STATUSES = ["active", "paused"] as const;
export type KeywordStatus = (typeof KEYWORD_STATUSES)[number];

/** A keyword to add (dashboard form, CSV import, REST API). Unset fields use the project defaults. */
export interface KeywordInput {
  phrase: string;
  country?: string;
  language?: string;
  device?: Device;
  location?: string;
  tags?: string[];
  targetUrl?: string | null;
}

/** SERP features recorded per check (what the results page showed, whoever owned it). */
export const SERP_FEATURES = [
  "featured_snippet",
  "local_pack",
  "ai_overview",
  "people_also_ask",
  "images",
  "videos",
  "top_stories",
  "shopping",
  "sitelinks",
  "knowledge_panel",
] as const;
export type SerpFeature = (typeof SERP_FEATURES)[number];

/** Result depths an administrator can choose (Google returns 10 results per page). */
export const RANK_DEPTHS = [10, 20, 50, 100] as const;
export type RankDepth = (typeof RANK_DEPTHS)[number];
export const DEFAULT_RANK_DEPTH: RankDepth = 20;

/** One organic result of a results page (serp_snapshots keep the top 20). */
export interface SerpResult {
  position: number;
  url: string;
  title: string;
  /** Bare hostname without "www.". */
  domain: string;
}

/** What a SERP provider returns for one keyword check. */
export interface RankResult {
  /** Position of the project's domain (best match, subdomains count); null = not in `depth`. */
  position: number | null;
  /** The project's ranking URL, or null. */
  url: string | null;
  features: SerpFeature[];
  /** Competitor domain → its best position (null = not in `depth`). */
  competitors: Record<string, number | null>;
  /** Organic results in order (at least the top 20 when available). */
  results: SerpResult[];
  /** Provider credits used, when reported. */
  credits?: number;
}

export interface SerpCheckInput {
  phrase: string;
  country: string;
  language: string;
  device: Device;
  /** City / region or "" for the whole country. */
  location: string;
  /** How many results to read (10/20/50/100). */
  depth: RankDepth;
  /** The project's domain (positions are reported for it). */
  domain: string;
  /** Competitor domains to report positions for. */
  competitors: string[];
}

/** A rank data source (src/lib/serp/providers/*). Implementations must not throw for "not found". */
export interface SerpProvider {
  /** Stable id stored in rankings.provider ("serper", "serpapi", "dataforseo", "valueserp", "simulated"). */
  id: string;
  /** Human name for the admin panel. */
  name: string;
  /** Throws SerpProviderError for configuration, quota or network problems. */
  check(input: SerpCheckInput): Promise<RankResult>;
}

export class SerpProviderError extends Error {
  constructor(
    message: string,
    /** "config" (no / wrong key), "quota" (credits exhausted, 402/429), "network", "response" (unexpected body). */
    readonly kind: "config" | "quota" | "network" | "response",
  ) {
    super(message);
    this.name = "SerpProviderError";
  }
}

// ── Site audits ──

export const AUDIT_STATUSES = ["queued", "crawling", "analyzing", "done", "failed", "cancelled"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_TRIGGERS = ["manual", "schedule", "api"] as const;
export type AuditTrigger = (typeof AUDIT_TRIGGERS)[number];

export const AUDIT_QUEUE_STATES = ["pending", "done", "skipped", "failed"] as const;
export type AuditQueueState = (typeof AUDIT_QUEUE_STATES)[number];

export const SEVERITIES = ["critical", "warning", "notice"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ISSUE_CATEGORIES = ["indexability", "content", "links", "performance", "social", "technical"] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

/**
 * Issue codes: lower-case snake_case ids such as "title_missing" or "broken_internal_link".
 * The registry (src/lib/audit/checks/index.ts) defines them; the dashboard shows the message key
 * `audit.issue.<code>` (title) and `audit.issue.<code>.help`.
 */
export type IssueCode = string;

/** Everything the crawler extracts from one page (columns of audit_pages + its data JSON). */
export interface AuditPageData {
  url: string;
  /** Final URL after redirects (same as url when not redirected). */
  finalUrl: string;
  statusCode: number | null;
  /** Redirect hops (each { url, status }); empty when not redirected. */
  redirects: Array<{ url: string; status: number }>;
  depth: number;
  contentType: string;
  sizeBytes: number;
  /** Time to the response headers (TTFB), ms. */
  ttfbMs: number;
  /** Time to the full body, ms. */
  loadMs: number;
  /** Content-Encoding (gzip, br…) or "". */
  encoding: string;
  /** X-Robots-Tag header, lower case. */
  xRobotsTag: string;
  isHtml: boolean;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  canonical: string | null;
  robotsMeta: string;
  lang: string;
  viewport: boolean;
  wordCount: number;
  /** Links found on the page (absolute URLs, fragment removed). */
  internalLinks: string[];
  externalLinks: string[];
  /** Images without (or with an empty) alt attribute. */
  imagesWithoutAlt: number;
  imagesTotal: number;
  /** http:// resources on an https:// page. */
  mixedContent: string[];
  hreflang: Array<{ lang: string; href: string }>;
  openGraph: Record<string, string>;
  twitterCard: Record<string, string>;
  /** Raw JSON-LD blocks; `valid` = parsed as JSON. */
  jsonLd: Array<{ valid: boolean; types: string[] }>;
  favicon: boolean;
  /** Internal links pointing to this page (known after the crawl). */
  inlinks: number;
  /** Network / parse error, if any. */
  error: string | null;
}

/** Site-wide facts the checks can use (robots.txt, sitemap, HTTPS, duplicates…). */
export interface AuditContext {
  /** Start URL of the crawl. */
  startUrl: string;
  host: string;
  https: boolean;
  robotsTxt: { found: boolean; valid: boolean; disallowAll: boolean; sitemaps: string[] } | null;
  sitemap: { found: boolean; valid: boolean; urls: number } | null;
  /** Whether http:// redirects to https:// (null = not checked). */
  httpRedirectsToHttps: boolean | null;
  /** Title / meta description → URLs that share it (duplicates; filled after the crawl). */
  duplicateTitles: Map<string, string[]>;
  duplicateDescriptions: Map<string, string[]>;
  /** URL → status code of every crawled page (broken link checks). */
  statusByUrl: Map<string, number | null>;
}

export interface AuditIssueFinding {
  code: IssueCode;
  /** Facts for the message (length, target URL…). */
  details?: Record<string, string | number | boolean>;
}

/** One check of the audit registry. */
export interface AuditCheck {
  code: IssueCode;
  severity: Severity;
  category: IssueCategory;
  /** Message key of the title (`audit.issue.<code>`). */
  titleKey: string;
  /** Page-level check: return the findings (usually 0 or 1) for this page. */
  test?: (page: AuditPageData, ctx: AuditContext) => AuditIssueFinding[] | AuditIssueFinding | null | false;
  /** Site-level check, run once per audit after the crawl. */
  testSite?: (ctx: AuditContext, pages: AuditPageData[]) => AuditIssueFinding[] | AuditIssueFinding | null | false;
}

/** audits.issues_summary JSON. */
export interface AuditSummary {
  critical: number;
  warning: number;
  notice: number;
  /** Issue code → affected pages (site-level issues count 1). */
  byCode: Record<IssueCode, number>;
  /** Pages with at least one critical issue / any issue. */
  pagesWithCritical: number;
  pagesWithIssues: number;
}

// ── Reports ──

export const REPORT_FREQUENCIES = ["weekly", "monthly"] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

// ── REST API (/api/v1, API key) ──

export interface ApiProject {
  id: number;
  name: string;
  domain: string;
  status: ProjectStatus;
  keywords: number;
  created_at: string;
}

export interface ApiKeyword {
  id: number;
  project_id: number;
  phrase: string;
  country: string;
  language: string;
  device: Device;
  location: string;
  tags: string[];
  target_url: string | null;
  status: KeywordStatus;
  position: number | null;
  best_position: number | null;
  url: string | null;
  last_checked_at: string | null;
}

// ── Alert channels (same senders as the sibling products) ──

export const CHANNEL_TYPES = ["email", "webhook", "slack", "discord", "telegram", "teams"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface ChannelConfigByType {
  /** Comma-separated addresses. */
  email: { to: string };
  /** Payload signed with HMAC-SHA256 of `secret` in the X-Searchzen-Signature header. */
  webhook: { url: string; secret: string };
  slack: { webhookUrl: string };
  discord: { webhookUrl: string };
  teams: { webhookUrl: string };
  telegram: { botToken: string; chatId: string };
}
export type ChannelConfig<T extends ChannelType = ChannelType> = ChannelConfigByType[T];

/** Events sent to alert channels. rank_* come from AlertRule hits, audit_* from finished audits. */
export const ALERT_EVENTS = [
  "rank_entered_top",
  "rank_left_top",
  "rank_changed",
  "rank_url_lost",
  "audit_finished",
  "audit_failed",
  "quota_warning",
  "quota_reached",
  "test",
] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

/** What every alert channel receives (also the JSON body of webhook alerts). */
export interface AlertPayload {
  event: AlertEvent;
  project: { id: number; name: string; domain: string } | null;
  /** Human-readable one-line summary, e.g. "\"seo tools\" moved from 14 to 6 (+8)". */
  message: string;
  /** Facts behind the alert (keyword, position, previous, change, score, used, limit…). */
  data: Record<string, number | string>;
  /** Link to the project in the dashboard. */
  url: string;
  sentAt: string;
}
