import { countryName, hostMatches } from "@/seo/normalize";
import { SerpProviderError, type RankResult, type SerpCheckInput, type SerpFeature, type SerpProvider, type SerpResult } from "@/seo/types";

/**
 * Helpers shared by the SERP providers: turning organic results (page by page) into a
 * RankResult, deciding when to stop paging, and mapping HTTP errors to SerpProviderError.
 * Dependency-free (unit-tested with recorded responses).
 */

/** What a provider adapter returns: the contract's RankResult plus the number of API requests made. */
export type ProviderResult = RankResult & { requests: number };

/** A provider adapter (src/lib/serp/providers/*): a SerpProvider that also reports its requests. */
export interface RankProvider extends SerpProvider {
  check(input: SerpCheckInput): Promise<ProviderResult>;
}

export type Obj = Record<string, unknown>;
export const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
export const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
/** True when a response block is present and not empty (array with items, object with keys, true). */
export const present = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : v && typeof v === "object" ? Object.keys(v as object).length > 0 : v === true;

/** Results per Google page. Since September 2025 Google ignores num=100, so every provider pages by 10. */
export const PAGE_SIZE = 10;

/** Other ways people write the last part of a location for some countries. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ["usa", "u.s.", "u.s.a.", "united states of america", "america"],
  GB: ["uk", "u.k.", "great britain", "britain"],
  AE: ["uae"],
};

/**
 * A keyword's location as place-name parts ending with the country's name, the shape every
 * provider understands ("City,Region,Country"): "Austin, Texas" with country US →
 * ["Austin", "Texas", "United States"]; a trailing country code or alias ("Austin, TX, USA")
 * is replaced by the name. "" (or just the country) → [] (the whole country).
 */
export function locationParts(location: string, country: string): string[] {
  const parts = location
    .split(",")
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (!parts.length) return [];
  const code = country.toUpperCase();
  const name = countryName(code);
  const known = new Set([name.toLowerCase(), code.toLowerCase(), ...(COUNTRY_ALIASES[code] ?? [])]);
  if (known.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  return parts.length ? [...parts, name] : [];
}

/** Bare hostname of a result URL without "www." ("" for anything that isn't http(s)). */
export function domainOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return "";
  }
}

export interface OrganicItem {
  url: string;
  title: string;
}

/**
 * Collects organic results across pages, numbering them 1, 2, 3… in order (repeated URLs are
 * skipped), and reports the project's and the competitors' best positions within `depth`.
 */
export class ResultCollector {
  private readonly seen = new Set<string>();
  readonly results: SerpResult[] = [];
  private position: number | null = null;
  private url: string | null = null;
  private readonly competitors = new Map<string, number | null>();

  constructor(private readonly input: Pick<SerpCheckInput, "domain" | "competitors" | "depth">) {
    for (const c of input.competitors) this.competitors.set(c, null);
  }

  get count(): number {
    return this.results.length;
  }

  add(items: OrganicItem[]): void {
    for (const item of items) {
      if (this.results.length >= this.input.depth) return;
      const url = item.url.trim();
      const domain = domainOf(url);
      if (!domain) continue;
      const key = url.replace(/#.*$/, "").replace(/\/$/, "");
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const position = this.results.length + 1;
      this.results.push({ position, url, title: item.title.trim().slice(0, 300), domain });
      if (this.position === null && hostMatches(domain, this.input.domain)) {
        this.position = position;
        this.url = url;
      }
      for (const [c, p] of this.competitors) if (p === null && hostMatches(domain, c)) this.competitors.set(c, position);
    }
  }

  /** The project's domain is found and every competitor too, or the depth is reached: stop paging. */
  done(): boolean {
    if (this.results.length >= this.input.depth) return true;
    if (this.position === null) return false;
    for (const p of this.competitors.values()) if (p === null) return false;
    return true;
  }

  result(features: Iterable<SerpFeature>, requests: number, credits?: number): ProviderResult {
    const set = new Set(features);
    return {
      position: this.position,
      url: this.url,
      features: FEATURE_ORDER.filter((f) => set.has(f)),
      competitors: Object.fromEntries(this.competitors),
      results: [...this.results],
      ...(credits !== undefined ? { credits } : {}),
      requests,
    };
  }
}

const FEATURE_ORDER: SerpFeature[] = [
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
];

/** Pages needed for a depth (10 → 1, 20 → 2, 50 → 5, 100 → 10). */
export function pagesFor(depth: number): number {
  return Math.max(1, Math.ceil(depth / PAGE_SIZE));
}

/**
 * The SerpProviderError for an unsuccessful HTTP answer: 401/403 = configuration (wrong key),
 * 402/429 or a message about credits = quota, 5xx = network (temporary), else response.
 */
export function httpError(provider: string, status: number, message: string): SerpProviderError {
  const msg = message.trim().slice(0, 200);
  const detail = msg ? `: ${msg}` : "";
  if (/credit|quota|balance|out of searches|run out|insufficient|payment|plan limit|exceeded/i.test(msg) || status === 402 || status === 429) {
    return new SerpProviderError(`${provider}: quota or credits exhausted (HTTP ${status})${detail}`, "quota");
  }
  if (status === 401 || status === 403 || /api[_ ]?key|unauthori[sz]ed|forbidden|not authori[sz]ed/i.test(msg)) {
    return new SerpProviderError(`${provider}: the API key was rejected (HTTP ${status})${detail}`, "config");
  }
  if (status >= 500) return new SerpProviderError(`${provider}: the service is unavailable (HTTP ${status})${detail}`, "network");
  return new SerpProviderError(`${provider}: unexpected answer (HTTP ${status})${detail}`, "response");
}

/** The first error-ish message of a JSON body ({ error }, { message }, { error: { message } }). */
export function errorMessage(json: unknown, text = ""): string {
  const o = asObj(json);
  const e = o.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") return asStr(asObj(e).message) || JSON.stringify(e).slice(0, 200);
  return asStr(o.message) || asStr(o.status_message) || (json === null ? text.slice(0, 200) : "");
}
