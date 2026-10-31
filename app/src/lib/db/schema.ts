import type { Generated, Insertable, Selectable, Updateable } from "kysely";

/**
 * Database schema shared by the MySQL and SQLite drivers.
 *
 * Portability rules used across the project:
 * - booleans are stored as 0 / 1 integers
 * - timestamps are ISO-8601 strings (see `now()` in ./index.ts)
 * - money is stored in the smallest currency unit (cents)
 * - JSON is stored as text (parse with parseJson() from src/seo/normalize.ts)
 * - days are "YYYY-MM-DD" strings (UTC unless stated otherwise)
 */

export interface SettingsTable {
  key: string;
  value: string | null;
}

export interface UsersTable {
  id: Generated<number>;
  name: string;
  email: string;
  password_hash: string;
  role: "user" | "admin";
  status: "active" | "banned";
  plan_id: number | null;
  plan_expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionsTable {
  id: string;
  user_id: number;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface PasswordResetsTable {
  token_hash: string;
  user_id: number;
  expires_at: string;
  created_at: string;
}

export interface PlansTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  features: string | null;
  /** Projects (websites) per account; 0 = unlimited. */
  max_projects: number;
  /** Tracked keywords across all projects of the account; 0 = unlimited. */
  max_keywords: number;
  /** Fastest rank check schedule: "weekly" or "daily". */
  check_frequency: "weekly" | "daily";
  /** Pages crawled per site audit; 0 = unlimited. */
  max_audit_pages: number;
  /** Site audits started per calendar month (all projects); 0 = unlimited. */
  max_audits_monthly: number;
  /** Google Search Console integration. */
  allow_gsc: number;
  /** Custom logo, colour and company name on client reports. */
  allow_white_label: number;
  /** REST API access (/api/v1). */
  allow_api: number;
  /** Hide the "Powered by" line in shared reports, badges and emails. */
  remove_branding: number;
  is_free: number;
  is_active: number;
  is_featured: number;
  sort_order: number;
  created_at: string;
}

export interface PaymentsTable {
  id: Generated<number>;
  user_id: number;
  plan_id: number;
  amount: number;
  currency: string;
  billing_cycle: "monthly" | "yearly";
  provider: "stripe" | "paypal" | "razorpay" | "offline";
  provider_ref: string;
  status: "pending" | "paid" | "rejected" | "refunded";
  note: string | null;
  created_at: string;
}

export interface PagesTable {
  id: Generated<number>;
  slug: string;
  title: string;
  content: string;
  meta_description: string | null;
  is_published: number;
  show_in_footer: number;
  created_at: string;
  updated_at: string;
}

export interface ContactMessagesTable {
  id: Generated<number>;
  name: string;
  email: string;
  subject: string;
  message: string;
  ip: string | null;
  is_read: number;
  created_at: string;
}

export interface LanguagesTable {
  code: string;
  name: string;
  native_name: string;
  direction: "ltr" | "rtl";
  is_active: number;
  sort_order: number;
}

export interface TranslationsTable {
  lang: string;
  key: string;
  value: string;
}

export interface PostsTable {
  id: Generated<number>;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  cover_image: string | null;
  meta_description: string | null;
  status: "draft" | "published";
  published_at: string | null;
  views: number;
  created_at: string;
  updated_at: string;
}

// ── SEO projects, rank tracking, site audits, Search Console ──

export interface ProjectsTable {
  id: Generated<number>;
  /** Owner. */
  user_id: number;
  name: string;
  /** Tracked website, bare hostname ("example.com", see normalizeDomain() in src/seo/normalize.ts). */
  domain: string;
  /** JSON: ProjectSettings (src/seo/types.ts); always read through normalizeProjectSettings(). */
  settings: string;
  /** "paused": no rank checks, scheduled audits or reports. */
  status: "active" | "paused";
  /** Public report link /r/<token> (null = sharing off). The optional password hash is in settings. */
  share_token: string | null;
  /** Search Console property picked for the project ("sc-domain:example.com" or a URL prefix). */
  gsc_property: string | null;
  /** gsc_connections row used to read gsc_property. */
  gsc_connection_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface KeywordsTable {
  id: Generated<number>;
  project_id: number;
  /** normalizeKeyword(): trimmed, lowercase, single spaces. */
  phrase: string;
  /** ISO 3166-1 alpha-2, upper case ("US"); Google gl = lower case. */
  country: string;
  /** Interface language, ISO 639-1 ("en"; Google hl). */
  language: string;
  device: "desktop" | "mobile";
  /** Optional city / region (provider location string), "" = whole country. */
  location: string;
  /** sha256 of phrase|country|language|device|location: unique per project (dedupe). */
  dedupe_key: string;
  /** JSON string[] of tags (normalizeTags()). */
  tags: string;
  /** Page that should rank (absolute URL) or null. */
  target_url: string | null;
  status: "active" | "paused";
  last_checked_at: string | null;
  /** Position at the last check; null = not in the checked depth (or never checked, see last_checked_at). */
  last_position: number | null;
  best_position: number | null;
  /** First position ever found (null until the keyword is first found in the results). */
  start_position: number | null;
  /** Ranking URL at the last check. */
  last_url: string | null;
  /** JSON SerpFeature[] seen on the last results page. */
  last_features: string;
  /** When the rank job checks it next (ISO); indexed with status for the due-keywords query. */
  next_check_at: string;
  /** Failed checks in a row (retry backoff); 0 after a success. */
  fail_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** One row per keyword and UTC day (the last check of the day wins). */
export interface RankingsTable {
  id: Generated<number>;
  keyword_id: number;
  /** Denormalised for project-wide charts (visibility, share of voice). */
  project_id: number;
  /** UTC day YYYY-MM-DD. */
  day: string;
  /** 1-based organic position; null = not found within the checked depth. */
  position: number | null;
  url: string | null;
  /** JSON SerpFeature[]. */
  features: string;
  /** JSON Record<domain, number | null>: competitor positions. */
  competitors: string;
  /** Provider id ("serper", "serpapi", "dataforseo", "valueserp", "simulated"). */
  provider: string;
  checked_at: string;
  /** JSON string[] of the alert rules fired for this keyword on this day (null = none). */
  alerts: string | null;
}

/** Top results of a check (kept 30 days). */
export interface SerpSnapshotsTable {
  id: Generated<number>;
  keyword_id: number;
  checked_at: string;
  /** JSON SerpResult[] (at most 20). */
  results: string;
}

export interface AuditsTable {
  id: Generated<number>;
  project_id: number;
  status: "queued" | "crawling" | "analyzing" | "done" | "failed" | "cancelled";
  triggered_by: "manual" | "schedule" | "api";
  /** JSON: crawl settings snapshot at start (CrawlSettings in src/seo/types.ts). */
  settings: string;
  started_at: string | null;
  finished_at: string | null;
  pages_crawled: number;
  /** Page cap of this audit (plan / project setting at start). */
  pages_limit: number;
  /** Health score 0–100 (healthScore()); null until analysed. */
  score: number | null;
  /** JSON AuditSummary: counts per severity and per issue code. */
  issues_summary: string;
  error: string | null;
  /** Tick lease: another tick does not work on the audit before this time. */
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditPagesTable {
  id: Generated<number>;
  audit_id: number;
  url: string;
  /** sha256 of the normalised URL (unique per audit). */
  url_hash: string;
  /** null = network error (see issues). */
  status_code: number | null;
  redirect_to: string | null;
  depth: number;
  content_type: string | null;
  size_bytes: number;
  load_ms: number;
  title: string | null;
  meta_description: string | null;
  h1_count: number;
  canonical: string | null;
  /** Content of <meta name="robots"> (and X-Robots-Tag), lower case. */
  robots_meta: string | null;
  word_count: number;
  internal_links: number;
  external_links: number;
  /** Internal links pointing to this page (filled while analysing). */
  inlinks: number;
  /** JSON: extra parsed data the checks need (AuditPageData fields not stored in columns). */
  data: string;
  /** JSON IssueCode[] found on the page. */
  issues: string;
  fetched_at: string;
}

/** Crawl frontier: URLs discovered for an audit (unique per audit; doubles as the "seen" set). */
export interface AuditQueueTable {
  id: Generated<number>;
  audit_id: number;
  url: string;
  url_hash: string;
  depth: number;
  /** Page where the URL was found (null for the start URL / sitemap). */
  found_on: string | null;
  state: "pending" | "done" | "skipped" | "failed";
  attempts: number;
  /** HTTP status of an external link check (depth -1 rows); null = not checked / no answer. */
  status_code: number | null;
  created_at: string;
}

export interface AuditIssuesTable {
  id: Generated<number>;
  audit_id: number;
  /** null for site-wide issues (robots.txt, sitemap, HTTPS…). */
  page_id: number | null;
  /** IssueCode (src/seo/types.ts). */
  code: string;
  severity: "critical" | "warning" | "notice";
  /** JSON: facts for the message (length, target URL…). */
  details: string;
}

/** A user's Google account connected for Search Console (read-only scope). */
export interface GscConnectionsTable {
  id: Generated<number>;
  user_id: number;
  google_email: string;
  /** Refresh token encrypted with the app secret (never shown again). */
  refresh_token: string;
  scopes: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Search Console rows (top N query/page pairs per project and day). */
export interface GscDailyTable {
  id: Generated<number>;
  project_id: number;
  day: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  /** 0–1. */
  ctr: number;
  /** Average position (1-based). */
  position: number;
}

/** SERP provider requests per provider and UTC day (Admin → SERP providers usage). */
export interface ProviderUsageTable {
  provider: string;
  day: string;
  requests: number;
  errors: number;
  /** Provider credits used, when the provider reports them (0 otherwise). */
  credits: number;
}

export interface ReportSchedulesTable {
  id: Generated<number>;
  project_id: number;
  frequency: "weekly" | "monthly";
  /** Comma-separated email addresses (up to 10). */
  recipients: string;
  is_active: number;
  last_sent_at: string | null;
  next_send_at: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKeysTable {
  id: Generated<number>;
  user_id: number;
  name: string;
  /** sha256 of the key; the key itself is shown once. */
  key_hash: string;
  /** First characters, to recognise the key in the list. */
  prefix: string;
  last_used_at: string | null;
  created_at: string;
}

export interface UsageMonthlyTable {
  user_id: number;
  /** YYYY-MM (UTC) */
  month: string;
  /** Rank checks sent to a SERP provider for the user's keywords. */
  serp_requests: number;
  /** Pages crawled by the user's site audits. */
  audit_pages: number;
  /** Site audits started (the plan's max_audits_monthly quota). */
  audits: number;
  /** Comma-separated quota alerts sent this month ("keywords:quota_warning,audits:quota_reached"), see src/lib/alerts/quota.ts. */
  quota_alerts: string | null;
}

export interface AlertChannelsTable {
  id: Generated<number>;
  user_id: number;
  type: "email" | "webhook" | "slack" | "discord" | "telegram" | "teams";
  name: string;
  /** JSON: channel config (ChannelConfigByType in src/seo/types.ts). */
  config: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AlertLogTable {
  id: Generated<number>;
  project_id: number | null;
  channel_id: number | null;
  event: string;
  ok: number;
  error: string | null;
  created_at: string;
}

export interface Database {
  settings: SettingsTable;
  users: UsersTable;
  sessions: SessionsTable;
  password_resets: PasswordResetsTable;
  plans: PlansTable;
  payments: PaymentsTable;
  pages: PagesTable;
  contact_messages: ContactMessagesTable;
  languages: LanguagesTable;
  translations: TranslationsTable;
  posts: PostsTable;
  projects: ProjectsTable;
  keywords: KeywordsTable;
  rankings: RankingsTable;
  serp_snapshots: SerpSnapshotsTable;
  audits: AuditsTable;
  audit_pages: AuditPagesTable;
  audit_queue: AuditQueueTable;
  audit_issues: AuditIssuesTable;
  gsc_connections: GscConnectionsTable;
  gsc_daily: GscDailyTable;
  provider_usage: ProviderUsageTable;
  report_schedules: ReportSchedulesTable;
  api_keys: ApiKeysTable;
  usage_monthly: UsageMonthlyTable;
  alert_channels: AlertChannelsTable;
  alert_log: AlertLogTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Plan = Selectable<PlansTable>;
export type Payment = Selectable<PaymentsTable>;
export type Page = Selectable<PagesTable>;
export type ContactMessage = Selectable<ContactMessagesTable>;
export type Language = Selectable<LanguagesTable>;
export type Post = Selectable<PostsTable>;
export type Project = Selectable<ProjectsTable>;
export type Keyword = Selectable<KeywordsTable>;
export type NewKeyword = Insertable<KeywordsTable>;
export type Ranking = Selectable<RankingsTable>;
export type SerpSnapshot = Selectable<SerpSnapshotsTable>;
export type Audit = Selectable<AuditsTable>;
export type AuditPage = Selectable<AuditPagesTable>;
export type AuditQueueItem = Selectable<AuditQueueTable>;
export type AuditIssue = Selectable<AuditIssuesTable>;
export type GscConnection = Selectable<GscConnectionsTable>;
export type GscDaily = Selectable<GscDailyTable>;
export type ReportSchedule = Selectable<ReportSchedulesTable>;
export type ApiKey = Selectable<ApiKeysTable>;
export type AlertChannel = Selectable<AlertChannelsTable>;
