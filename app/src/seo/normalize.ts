/**
 * Turns untrusted input (dashboard forms, CSV imports, stored JSON, REST API bodies) into valid
 * values, and holds the SEO math shared by the rank tracker, the audit and the reports
 * (position changes, visibility, health score, check schedules). Unknown keys are dropped,
 * missing keys get defaults. Dependency-free (server, client components and tests).
 */

import {
  ALERT_RULE_TYPES,
  ALERT_TOPS,
  AUDIT_SCHEDULES,
  CHANNEL_TYPES,
  CHECK_FREQUENCIES,
  DEVICES,
  SERP_FEATURES,
  USER_AGENT_MODES,
  type AlertRule,
  type AlertTop,
  type ChannelConfigByType,
  type ChannelType,
  type CheckFrequency,
  type Device,
  type ProjectSettings,
  type ReportBranding,
  type SerpFeature,
  type Severity,
} from "./types";

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : fallback;

const DAY_MS = 86_400_000;

// ── Primitive helpers ──

/** JSON.parse that never throws: {} for empty or invalid text. */
export function parseJson(text: string | null | undefined): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** A JSON array of strings (tags, features…) from stored text; [] when invalid. */
export function parseJsonList(text: string | null | undefined): string[] {
  const v = parseJson(text);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Trimmed string without control characters, at most `max` characters. */
export function str(v: unknown, fallback = "", max = 500): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v).slice(0, max);
  if (typeof v !== "string") return fallback;
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max);
}

/** Like str() but keeps line breaks (notes, bulk keyword lists). */
export function text(v: unknown, max = 20_000): string {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max);
}

export function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "on" || v === 1 || v === "1") return true;
  if (v === "false" || v === "off" || v === 0 || v === "0") return false;
  return fallback;
}

/** Integer clamped to [min, max]; `fallback` when not a number. */
export function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function list(v: unknown, max: number, each: (s: string) => string): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]+/) : [];
  return [...new Set(raw.map((x) => each(String(x))).filter(Boolean))].slice(0, max);
}

// ── Identifiers ──

/** "https://WWW.Example.com/path" → "example.com"; "" when invalid. Keeps subdomains other than www. */
export function normalizeDomain(v: unknown): string {
  if (typeof v !== "string") return "";
  let value = v.trim().toLowerCase();
  if (!value) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `http://${value}`;
  try {
    const host = new URL(value).hostname.replace(/\.$/, "").replace(/^www\./, "");
    if (!/^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(host) || host.includes("..")) return "";
    return host;
  } catch {
    return "";
  }
}

/** True when `host` is `domain`, www.`domain` or a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  if (!domain) return false;
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return h === domain || h.endsWith(`.${domain}`);
}

/** Lowercase email or "" when it doesn't look like one. */
export function normalizeEmail(v: unknown): string {
  const s = str(v, "", 190).toLowerCase();
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(s) ? s : "";
}

/** Up to `max` valid, distinct email addresses from a comma / space / newline separated list. */
export function normalizeEmailList(v: unknown, max = 10): string[] {
  return list(typeof v === "string" ? v.replace(/[;\s]+/g, ",") : v, max, normalizeEmail);
}

/** #rrggbb (or "" when invalid). "#abc" is expanded. */
export function normalizeColor(v: unknown): string {
  const s = str(v, "", 7).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return "";
}

/** http(s) URL or "". */
export function httpUrl(v: unknown): string {
  if (typeof v !== "string") return "";
  const value = v.trim().slice(0, 1000);
  return /^https?:\/\/[^\s"'<>]+$/i.test(value) ? value : "";
}

// ── Countries and languages (Google gl / hl) ──

/** ISO 3166-1 alpha-2 codes with English names; Google's gl parameter is the lower-case code. */
export const COUNTRIES: ReadonlyArray<readonly [code: string, name: string]> = [
  ["AE", "United Arab Emirates"],
  ["AR", "Argentina"],
  ["AT", "Austria"],
  ["AU", "Australia"],
  ["BD", "Bangladesh"],
  ["BE", "Belgium"],
  ["BG", "Bulgaria"],
  ["BR", "Brazil"],
  ["CA", "Canada"],
  ["CH", "Switzerland"],
  ["CL", "Chile"],
  ["CN", "China"],
  ["CO", "Colombia"],
  ["CZ", "Czechia"],
  ["DE", "Germany"],
  ["DK", "Denmark"],
  ["DZ", "Algeria"],
  ["EC", "Ecuador"],
  ["EE", "Estonia"],
  ["EG", "Egypt"],
  ["ES", "Spain"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["GB", "United Kingdom"],
  ["GH", "Ghana"],
  ["GR", "Greece"],
  ["HK", "Hong Kong"],
  ["HR", "Croatia"],
  ["HU", "Hungary"],
  ["ID", "Indonesia"],
  ["IE", "Ireland"],
  ["IL", "Israel"],
  ["IN", "India"],
  ["IQ", "Iraq"],
  ["IT", "Italy"],
  ["JO", "Jordan"],
  ["JP", "Japan"],
  ["KE", "Kenya"],
  ["KR", "South Korea"],
  ["KW", "Kuwait"],
  ["KZ", "Kazakhstan"],
  ["LB", "Lebanon"],
  ["LK", "Sri Lanka"],
  ["LT", "Lithuania"],
  ["LV", "Latvia"],
  ["MA", "Morocco"],
  ["MX", "Mexico"],
  ["MY", "Malaysia"],
  ["NG", "Nigeria"],
  ["NL", "Netherlands"],
  ["NO", "Norway"],
  ["NP", "Nepal"],
  ["NZ", "New Zealand"],
  ["OM", "Oman"],
  ["PE", "Peru"],
  ["PH", "Philippines"],
  ["PK", "Pakistan"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["QA", "Qatar"],
  ["RO", "Romania"],
  ["RS", "Serbia"],
  ["SA", "Saudi Arabia"],
  ["SE", "Sweden"],
  ["SG", "Singapore"],
  ["SI", "Slovenia"],
  ["SK", "Slovakia"],
  ["TH", "Thailand"],
  ["TN", "Tunisia"],
  ["TR", "Türkiye"],
  ["TW", "Taiwan"],
  ["UA", "Ukraine"],
  ["US", "United States"],
  ["UY", "Uruguay"],
  ["VE", "Venezuela"],
  ["VN", "Vietnam"],
  ["ZA", "South Africa"],
];

/** Google interface languages (hl) with English names. */
export const LANGUAGES: ReadonlyArray<readonly [code: string, name: string]> = [
  ["ar", "Arabic"],
  ["bg", "Bulgarian"],
  ["bn", "Bengali"],
  ["cs", "Czech"],
  ["da", "Danish"],
  ["de", "German"],
  ["el", "Greek"],
  ["en", "English"],
  ["es", "Spanish"],
  ["et", "Estonian"],
  ["fa", "Persian"],
  ["fi", "Finnish"],
  ["fr", "French"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["hr", "Croatian"],
  ["hu", "Hungarian"],
  ["id", "Indonesian"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["kk", "Kazakh"],
  ["ko", "Korean"],
  ["lt", "Lithuanian"],
  ["lv", "Latvian"],
  ["mr", "Marathi"],
  ["ms", "Malay"],
  ["ne", "Nepali"],
  ["nl", "Dutch"],
  ["no", "Norwegian"],
  ["pl", "Polish"],
  ["pt", "Portuguese"],
  ["pt-BR", "Portuguese (Brazil)"],
  ["ro", "Romanian"],
  ["ru", "Russian"],
  ["si", "Sinhala"],
  ["sk", "Slovak"],
  ["sl", "Slovenian"],
  ["sr", "Serbian"],
  ["sv", "Swedish"],
  ["sw", "Swahili"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["th", "Thai"],
  ["tl", "Filipino"],
  ["tr", "Turkish"],
  ["uk", "Ukrainian"],
  ["ur", "Urdu"],
  ["vi", "Vietnamese"],
  ["zh-CN", "Chinese (Simplified)"],
  ["zh-TW", "Chinese (Traditional)"],
];

const COUNTRY_CODES = new Set(COUNTRIES.map(([c]) => c));
const LANGUAGE_CODES = new Map(LANGUAGES.map(([c]) => [c.toLowerCase(), c]));

/** "us" / "US" → "US" when it is a listed country, else `fallback`. */
export function normalizeCountry(v: unknown, fallback = "US"): string {
  const s = str(v, "", 2).toUpperCase();
  return COUNTRY_CODES.has(s) ? s : fallback;
}

/** "EN" / "pt_br" → "en" / "pt-BR" when it is a listed language, else `fallback`. */
export function normalizeLanguage(v: unknown, fallback = "en"): string {
  const s = str(v, "", 10).replace("_", "-").toLowerCase();
  return LANGUAGE_CODES.get(s) ?? fallback;
}

export function countryName(code: string): string {
  return COUNTRIES.find(([c]) => c === code)?.[1] ?? code;
}

export function languageName(code: string): string {
  return LANGUAGES.find(([c]) => c === code)?.[1] ?? code;
}

/** Google's gl parameter ("US" → "us"; the United Kingdom is "uk" for Google). */
export function googleGl(country: string): string {
  const c = country.toLowerCase();
  return c === "gb" ? "uk" : c;
}

/** Google's hl parameter ("pt-BR" → "pt-BR", "en" → "en"). */
export function googleHl(language: string): string {
  return language;
}

export function normalizeDevice(v: unknown, fallback: Device = "desktop"): Device {
  return oneOf(DEVICES, v, fallback);
}

// ── Keywords ──

export const MAX_KEYWORD_LENGTH = 200;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

/**
 * A search phrase as it is tracked: Unicode NFC, lower case, single spaces, no control
 * characters, at most MAX_KEYWORD_LENGTH characters. "" when nothing is left.
 * "  Best  SEO Tools\t" → "best seo tools".
 */
export function normalizeKeyword(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFC")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_KEYWORD_LENGTH)
    .trim();
}

/** One keyword per line (or per comma when there is a single line), normalised and de-duplicated. */
export function parseKeywordList(v: unknown, max = 5000): string[] {
  if (typeof v !== "string") return [];
  const lines = v.includes("\n") ? v.split(/\r?\n/) : v.split(",");
  return [...new Set(lines.map(normalizeKeyword).filter(Boolean))].slice(0, max);
}

/** Tags: trimmed, single spaces, at most MAX_TAG_LENGTH characters each, case-insensitively unique, up to MAX_TAGS. */
export function normalizeTags(v: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]+/) : [];
  for (const item of raw) {
    const tag = str(item, "", 100).replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH).trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Target URL of a keyword: an absolute http(s) URL on the project's domain (or a subdomain);
 * a path ("/pricing") is resolved against https://<domain>. null when empty or on another site.
 */
export function normalizeTargetUrl(v: unknown, domain: string): string | null {
  const s = str(v, "", 1000);
  if (!s) return null;
  try {
    const url = s.startsWith("/") ? new URL(s, `https://${domain}`) : new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!hostMatches(url.hostname, domain)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The text that identifies a keyword within a project (hash it for keywords.dedupe_key):
 * the same phrase may be tracked once per country, language, device and location.
 */
export function keywordIdentity(k: { phrase: string; country: string; language: string; device: Device; location: string }): string {
  return [normalizeKeyword(k.phrase), k.country.toUpperCase(), k.language, k.device, k.location.trim().toLowerCase()].join("|");
}

export function isSerpFeature(v: unknown): v is SerpFeature {
  return typeof v === "string" && (SERP_FEATURES as readonly string[]).includes(v);
}

/** Known SERP feature codes from a list (stored JSON, provider data), in registry order. */
export function normalizeFeatures(v: unknown): SerpFeature[] {
  const set = new Set(Array.isArray(v) ? v.filter(isSerpFeature) : []);
  return SERP_FEATURES.filter((f) => set.has(f));
}

// ── Project settings ──

export const MAX_COMPETITORS = 5;
export const MAX_ALERT_RULES = 10;
export const MAX_CRAWL_DELAY_MS = 10_000;

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  country: "US",
  language: "en",
  device: "desktop",
  location: "",
  competitors: [],
  checkFrequency: "daily",
  auditSchedule: "off",
  auditPageLimit: 0,
  crawlDelayMs: 0,
  includePatterns: [],
  excludePatterns: [],
  userAgent: "bot",
  alertRules: [{ type: "enters_top", top: 10 }, { type: "leaves_top", top: 10 }],
  alertChannelIds: [],
  alertOnAudit: true,
  report: { companyName: "", logo: "", color: "" },
  sharePasswordHash: "",
};

/** A crawl include / exclude pattern: a path starting with "/", "*" wildcards, at most 200 characters. */
export function normalizePattern(v: unknown): string {
  let s = str(v, "", 200).replace(/\s+/g, "");
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = u.pathname + u.search;
    } catch {
      return "";
    }
  }
  if (!s.startsWith("/") && !s.startsWith("*")) s = `/${s}`;
  return s.replace(/\*{2,}/g, "*");
}

/** True when the path (with query) of a URL matches a pattern: prefix match, "*" matches anything. */
export function pathMatches(pathWithQuery: string, pattern: string): boolean {
  if (!pattern) return false;
  const re = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}`);
  return re.test(pathWithQuery);
}

export function normalizeAlertRule(v: unknown): AlertRule | null {
  const o = asObj(v);
  const type = oneOf(ALERT_RULE_TYPES, o.type, "" as never);
  const top = Number(o.top);
  switch (type) {
    case "enters_top":
    case "leaves_top":
      return (ALERT_TOPS as readonly number[]).includes(top) ? { type, top: top as AlertTop } : null;
    case "change":
      return { type, min: int(o.min, 5, 1, 100) };
    case "url_lost":
      return { type };
    default:
      return null;
  }
}

export function normalizeAlertRules(v: unknown): AlertRule[] {
  const out: AlertRule[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(v) ? v : []) {
    const rule = normalizeAlertRule(item);
    if (!rule) continue;
    const key = JSON.stringify(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
    if (out.length >= MAX_ALERT_RULES) break;
  }
  return out;
}

export function normalizeReportBranding(v: unknown): ReportBranding {
  const o = asObj(v);
  return { companyName: str(o.companyName, "", 120), logo: str(o.logo, "", 500), color: normalizeColor(o.color) };
}

function idList(v: unknown, max: number): number[] {
  return [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, max);
}

/**
 * Project settings from stored JSON or a form: every field validated and clamped, unknown keys
 * dropped. `domain` (the project's own) is removed from the competitors.
 */
export function normalizeProjectSettings(input: unknown, domain = ""): ProjectSettings {
  const o = asObj(input);
  const d = DEFAULT_PROJECT_SETTINGS;
  return {
    country: normalizeCountry(o.country, d.country),
    language: normalizeLanguage(o.language, d.language),
    device: normalizeDevice(o.device, d.device),
    location: str(o.location, "", 120),
    competitors: list(o.competitors, MAX_COMPETITORS + 1, normalizeDomain)
      .filter((c) => c !== domain)
      .slice(0, MAX_COMPETITORS),
    checkFrequency: oneOf(CHECK_FREQUENCIES, o.checkFrequency, d.checkFrequency),
    auditSchedule: oneOf(AUDIT_SCHEDULES, o.auditSchedule, d.auditSchedule),
    auditPageLimit: int(o.auditPageLimit, d.auditPageLimit, 0, 1_000_000),
    crawlDelayMs: int(o.crawlDelayMs, d.crawlDelayMs, 0, MAX_CRAWL_DELAY_MS),
    includePatterns: list(o.includePatterns, 20, normalizePattern),
    excludePatterns: list(o.excludePatterns, 20, normalizePattern),
    userAgent: oneOf(USER_AGENT_MODES, o.userAgent, d.userAgent),
    alertRules: o.alertRules === undefined ? d.alertRules.map((r) => ({ ...r })) : normalizeAlertRules(o.alertRules),
    alertChannelIds: idList(o.alertChannelIds, 20),
    alertOnAudit: bool(o.alertOnAudit, d.alertOnAudit),
    report: normalizeReportBranding(o.report),
    sharePasswordHash: str(o.sharePasswordHash, "", 255),
  };
}

/** The check frequency that applies: the project's wish, capped by the plan ("weekly" plans check weekly). */
export function effectiveFrequency(wanted: CheckFrequency, planMax: CheckFrequency): CheckFrequency {
  return planMax === "weekly" ? "weekly" : wanted;
}

/** Pages an audit may crawl: the project setting (0 = no own cap) within the plan's limit (0 = unlimited). */
/** Pages per audit when neither the project nor the plan sets a limit (unlimited plans, admins). */
export const DEFAULT_UNLIMITED_PAGE_LIMIT = 500;

export function effectivePageLimit(projectLimit: number, planLimit: number, hardCap = 50_000): number {
  const plan = planLimit > 0 ? planLimit : hardCap;
  // An unlimited plan should not crawl 50,000 pages by accident: use a sensible default unless the project asks for more.
  const wanted = projectLimit > 0 ? projectLimit : planLimit > 0 ? plan : DEFAULT_UNLIMITED_PAGE_LIMIT;
  return Math.max(1, Math.min(wanted, plan, hardCap));
}

// ── Positions, visibility, health ──

export type PositionChangeKind = "up" | "down" | "same" | "new" | "lost" | "none";

export interface PositionChange {
  kind: PositionChangeKind;
  /** Places gained (positive) or lost (negative); null for new / lost / none. */
  delta: number | null;
}

/**
 * Change between two positions (null = not ranked). Lower is better, so moving from 14 to 6 is
 * { kind: "up", delta: 8 }; from 6 to 14 { kind: "down", delta: -8 }; from not ranked to 30
 * "new"; from 30 to not ranked "lost"; not ranked both times "none".
 */
export function positionChange(previous: number | null | undefined, current: number | null | undefined): PositionChange {
  const prev = previous ?? null;
  const cur = current ?? null;
  if (prev === null && cur === null) return { kind: "none", delta: null };
  if (prev === null) return { kind: "new", delta: null };
  if (cur === null) return { kind: "lost", delta: null };
  const delta = prev - cur;
  return { kind: delta > 0 ? "up" : delta < 0 ? "down" : "same", delta };
}

/**
 * Expected organic click-through rate by position (1-based), a typical desktop + mobile curve
 * (position 1 ≈ 28 %, 10 ≈ 2 %). Positions 21–100 get a small share; beyond 100 / not ranked 0.
 */
const CTR_TOP20 = [0.28, 0.155, 0.1, 0.07, 0.052, 0.039, 0.03, 0.024, 0.02, 0.017, 0.012, 0.011, 0.01, 0.009, 0.008, 0.007, 0.0065, 0.006, 0.0055, 0.005];

export function expectedCtr(position: number | null | undefined): number {
  if (!position || position < 1 || position > 100) return 0;
  if (position <= 20) return CTR_TOP20[Math.round(position) - 1] ?? 0;
  if (position <= 50) return 0.002;
  return 0.0005;
}

/**
 * Visibility of a set of keywords, 0–100: the expected clicks of their positions (CTR curve)
 * as a share of the clicks they would get if every keyword ranked #1. One decimal.
 * Optional weights (e.g. search volume) default to 1 per keyword.
 */
export function visibilityScore(positions: ReadonlyArray<number | null>, weights?: ReadonlyArray<number>): number {
  if (!positions.length) return 0;
  let got = 0;
  let max = 0;
  positions.forEach((p, i) => {
    const w = weights?.[i] !== undefined && weights[i] > 0 ? weights[i] : 1;
    got += expectedCtr(p) * w;
    max += CTR_TOP20[0] * w;
  });
  return max > 0 ? Math.round((got / max) * 1000) / 10 : 0;
}

/** Average of the ranked positions (not ranked keywords are left out); null when none ranks. */
export function averagePosition(positions: ReadonlyArray<number | null>): number | null {
  const ranked = positions.filter((p): p is number => typeof p === "number" && p > 0);
  if (!ranked.length) return null;
  return Math.round((ranked.reduce((a, b) => a + b, 0) / ranked.length) * 10) / 10;
}

/** Weight of one issue in the health score, by severity. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 10, warning: 3, notice: 0.5 };
/** Flat deduction for a site-wide issue (robots.txt, sitemap, HTTPS…), by severity. */
export const SITE_ISSUE_PENALTY: Record<Severity, number> = { critical: 8, warning: 3, notice: 1 };

/**
 * Site health score 0–100 of an audit.
 *
 *   density   = Σ SEVERITY_WEIGHT of the page-level issues / pages crawled
 *   pageScore = 100 / (1 + density / 10)
 *   penalty   = min(30, Σ SITE_ISSUE_PENALTY of the site-wide issues)
 *   score     = round(pageScore − penalty), clamped to 0–100
 *
 * So a site with no issues scores 100; on average one critical issue per page halves the page
 * score (density 10 → 50); one warning on every page gives 77; one notice on every page 95.
 * Site-wide issues cost a fixed number of points whatever the size of the site. 0 pages → 0.
 */
export function healthScore(issues: ReadonlyArray<{ severity: Severity; site?: boolean }>, pages: number): number {
  if (!(pages > 0)) return 0;
  let weight = 0;
  let penalty = 0;
  for (const issue of issues) {
    if (issue.site) penalty += SITE_ISSUE_PENALTY[issue.severity] ?? 0;
    else weight += SEVERITY_WEIGHT[issue.severity] ?? 0;
  }
  const pageScore = 100 / (1 + weight / pages / 10);
  return Math.max(0, Math.min(100, Math.round(pageScore - Math.min(30, penalty))));
}

/** "good" (≥ 80), "fair" (50–79) or "poor" (< 50): colour of a health score. */
export function scoreGrade(score: number | null | undefined): "good" | "fair" | "poor" | "none" {
  if (score === null || score === undefined || !Number.isFinite(score)) return "none";
  return score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
}

// ── Schedules ──

/** Time between two rank checks of a keyword. */
export function checkIntervalMs(frequency: CheckFrequency): number {
  return frequency === "weekly" ? 7 * DAY_MS : DAY_MS;
}

/** When a keyword checked at `from` (default now) is due again, as an ISO string. */
export function nextCheckAt(frequency: CheckFrequency, from: Date | number | string = Date.now()): string {
  const base = typeof from === "string" ? Date.parse(from) : typeof from === "number" ? from : from.getTime();
  return new Date((Number.isFinite(base) ? base : Date.now()) + checkIntervalMs(frequency)).toISOString();
}

/** Retry delay after `failCount` failed checks in a row: 15 min, 1 h, 4 h, then 12 h. */
export function retryDelayMs(failCount: number): number {
  const steps = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000];
  return steps[Math.min(Math.max(failCount, 1), steps.length) - 1];
}

// ── Alert channels ──

export function isChannelType(v: unknown): v is ChannelType {
  return typeof v === "string" && (CHANNEL_TYPES as readonly string[]).includes(v);
}

export function normalizeChannelConfig<T extends ChannelType>(type: T, input: unknown): ChannelConfigByType[T] {
  const o = asObj(input);
  let out: unknown;
  switch (type) {
    case "email":
      out = {
        to: str(o.to, "", 1000)
          .split(/[,;\s]+/)
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
          .slice(0, 10)
          .join(", "),
      };
      break;
    case "webhook":
      out = { url: httpUrl(o.url), secret: str(o.secret, "", 200) };
      break;
    case "slack":
    case "discord":
    case "teams":
      out = { webhookUrl: httpUrl(o.webhookUrl) };
      break;
    case "telegram":
      out = { botToken: str(o.botToken, "", 100).replace(/[^A-Za-z0-9:_-]/g, ""), chatId: str(o.chatId, "", 40).replace(/[^0-9@A-Za-z_-]/g, "") };
      break;
  }
  return out as ChannelConfigByType[T];
}

export function channelProblem(type: ChannelType, config: unknown): string {
  const c = asObj(config);
  if (type === "email" && !c.to) return "Enter at least one valid email address.";
  if (type === "webhook" && !c.url) return "Enter the webhook URL (https://…).";
  if ((type === "slack" || type === "discord" || type === "teams") && !c.webhookUrl) return "Paste the incoming webhook URL.";
  if (type === "telegram" && (!c.botToken || !c.chatId)) return "Enter the bot token and the chat ID.";
  return "";
}
