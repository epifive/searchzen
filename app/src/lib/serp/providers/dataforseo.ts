import { countryName } from "@/seo/normalize";
import { SerpProviderError, type SerpFeature } from "@/seo/types";
import type { SerpFetch } from "../http";
import { asList, asObj, asStr, errorMessage, httpError, locationParts, pagesFor, ResultCollector, type RankProvider } from "../parse";

/**
 * DataForSEO — POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced
 * (Live mode, one task per call) with HTTP Basic authentication: the "API key" is
 * "login:password" from the DataForSEO dashboard. DataForSEO pages through Google itself:
 * `depth` is the number of results and every page of 10 is billed; without competitors
 * `stop_crawl_on_match` stops as soon as the project's domain is found.
 * The cost in USD is recorded as credits of 1/10,000 USD (0.002 USD = 20).
 */

export const DATAFORSEO_ENDPOINT = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

/** ISO 3166-1 numeric codes: DataForSEO's country location_code is 2000 + this number. */
const ISO_NUMERIC: Record<string, number> = {
  AE: 784, AR: 32, AT: 40, AU: 36, BD: 50, BE: 56, BG: 100, BR: 76, CA: 124, CH: 756, CL: 152, CN: 156, CO: 170, CZ: 203,
  DE: 276, DK: 208, DZ: 12, EC: 218, EE: 233, EG: 818, ES: 724, FI: 246, FR: 250, GB: 826, GH: 288, GR: 300, HK: 344,
  HR: 191, HU: 348, ID: 360, IE: 372, IL: 376, IN: 356, IQ: 368, IT: 380, JO: 400, JP: 392, KE: 404, KR: 410, KW: 414,
  KZ: 398, LB: 422, LK: 144, LT: 440, LV: 428, MA: 504, MX: 484, MY: 458, NG: 566, NL: 528, NO: 578, NP: 524, NZ: 554,
  OM: 512, PE: 604, PH: 608, PK: 586, PL: 616, PT: 620, QA: 634, RO: 642, RS: 688, SA: 682, SE: 752, SG: 702, SI: 705,
  SK: 703, TH: 764, TN: 788, TR: 792, TW: 158, UA: 804, US: 840, UY: 858, VE: 862, VN: 704, ZA: 710,
};

export function dataforseoLocationCode(country: string): number | null {
  const n = ISO_NUMERIC[country.toUpperCase()];
  return n ? 2000 + n : null;
}

/** DataForSEO language codes: "pt-BR" is "pt"; Chinese keeps its script ("zh-CN" / "zh-TW"). */
export function dataforseoLanguage(language: string): string {
  return language.startsWith("zh") ? language : language.split("-")[0];
}

const FEATURE_BY_TYPE: Record<string, SerpFeature> = {
  featured_snippet: "featured_snippet",
  answer_box: "featured_snippet",
  local_pack: "local_pack",
  map: "local_pack",
  ai_overview: "ai_overview",
  people_also_ask: "people_also_ask",
  images: "images",
  video: "videos",
  short_videos: "videos",
  top_stories: "top_stories",
  shopping: "shopping",
  popular_products: "shopping",
  knowledge_graph: "knowledge_panel",
};

function firstResult(json: unknown) {
  const task = asObj(asList(asObj(json).tasks)[0]);
  return { task, result: asObj(asList(task.result)[0]) };
}

export function dataforseoFeatures(json: unknown): SerpFeature[] {
  const items = asList(firstResult(json).result.items).map(asObj);
  const out = new Set<SerpFeature>();
  for (const item of items) {
    const f = FEATURE_BY_TYPE[asStr(item.type)];
    if (f) out.add(f);
    if (item.type === "organic" && asList(item.links).length) out.add("sitelinks");
  }
  return [...out];
}

export function dataforseoOrganic(json: unknown): Array<{ url: string; title: string }> {
  return asList(firstResult(json).result.items)
    .map(asObj)
    .filter((i) => i.type === "organic")
    .sort((a, b) => (Number(a.rank_group) || 0) - (Number(b.rank_group) || 0))
    .map((i) => ({ url: asStr(i.url), title: asStr(i.title) }))
    .filter((r) => r.url);
}

export function dataforseoTask(input: { phrase: string; country: string; language: string; device: string; location: string; depth: number; domain: string; competitors: string[] }) {
  const task: Record<string, unknown> = {
    keyword: input.phrase,
    language_code: dataforseoLanguage(input.language),
    device: input.device === "mobile" ? "mobile" : "desktop",
    depth: input.depth,
  };
  const code = dataforseoLocationCode(input.country);
  // DataForSEO wants full names without spaces after the commas: "Austin,Texas,United States".
  const place = locationParts(input.location, input.country);
  if (place.length) task.location_name = place.join(",");
  else if (code) task.location_code = code;
  else task.location_name = countryName(input.country);
  if (!input.competitors.length) task.stop_crawl_on_match = [{ match_value: input.domain, match_type: "with_subdomains" }];
  return task;
}

/** Task status codes: 401xx authentication, 402xx money / limits, 5xxxx temporary. */
function taskError(code: number, message: string): SerpProviderError {
  const text = `DataForSEO: ${message || "error"} (${code})`;
  if (code >= 40100 && code < 40200) return new SerpProviderError(text, "config");
  if (code >= 40200 && code < 40300) return new SerpProviderError(text, "quota");
  if (code >= 50000) return new SerpProviderError(text, "network");
  return new SerpProviderError(text, "response");
}

export function createDataForSeoProvider(options: { apiKey: string; fetch: SerpFetch; timeoutMs?: number }): RankProvider {
  return {
    id: "dataforseo",
    name: "DataForSEO",
    async check(input) {
      const [login, ...rest] = options.apiKey.split(":");
      const password = rest.join(":");
      if (!login || !password) throw new SerpProviderError("DataForSEO: enter the API login and password as login:password.", "config");
      const res = await options.fetch({
        url: DATAFORSEO_ENDPOINT,
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`, "Content-Type": "application/json" },
        body: JSON.stringify([dataforseoTask(input)]),
        // DataForSEO crawls several Google pages in one call: allow it more time.
        timeoutMs: Math.max(options.timeoutMs ?? 20_000, 15_000 + pagesFor(input.depth) * 3_000),
      });
      const json = asObj(res.json);
      if (res.status !== 200) throw httpError("DataForSEO", res.status, errorMessage(res.json, res.text));
      if (!res.json) throw new SerpProviderError("DataForSEO: the response was not JSON.", "response");
      const status = Number(json.status_code);
      if (status && status !== 20000) throw taskError(status, asStr(json.status_message));
      const { task, result } = firstResult(res.json);
      const taskStatus = Number(task.status_code);
      if (taskStatus && taskStatus !== 20000) throw taskError(taskStatus, asStr(task.status_message));
      const collector = new ResultCollector(input);
      collector.add(dataforseoOrganic(res.json));
      const pages = Number(result.pages_count) || 1;
      const cost = Number(task.cost ?? json.cost) || 0;
      return collector.result(dataforseoFeatures(res.json), pages, Math.round(cost * 10_000));
    },
  };
}
