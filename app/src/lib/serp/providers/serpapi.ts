import { googleGl, googleHl } from "@/seo/normalize";
import { SerpProviderError, type SerpFeature } from "@/seo/types";
import type { SerpFetch } from "../http";
import { asList, asObj, asStr, errorMessage, httpError, locationParts, pagesFor, PAGE_SIZE, present, ResultCollector, type RankProvider } from "../parse";

/**
 * SerpApi — GET https://serpapi.com/search.json?engine=google&q=…&api_key=…
 * One search per page of 10 results (`start=0, 10, 20…`); `device` desktop / mobile,
 * `location` a city or region name. Each search uses one credit of the plan.
 */

export const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

/** SerpApi answers HTTP 200 with this error when the query simply has no results. */
const NO_RESULTS = /hasn't returned any results|no results/i;

export function serpapiFeatures(json: unknown): SerpFeature[] {
  const o = asObj(json);
  const out: SerpFeature[] = [];
  if (present(o.answer_box) || present(o.featured_snippet)) out.push("featured_snippet");
  if (present(o.local_results) || present(o.local_map)) out.push("local_pack");
  if (present(o.ai_overview)) out.push("ai_overview");
  if (present(o.related_questions)) out.push("people_also_ask");
  if (present(o.inline_images) || present(o.images_results)) out.push("images");
  if (present(o.inline_videos) || present(o.video_results) || present(o.short_videos)) out.push("videos");
  if (present(o.top_stories)) out.push("top_stories");
  if (present(o.shopping_results) || present(o.inline_shopping) || present(o.immersive_products)) out.push("shopping");
  if (asList(o.organic_results).some((r) => present(asObj(r).sitelinks))) out.push("sitelinks");
  if (present(o.knowledge_graph)) out.push("knowledge_panel");
  return out;
}

export function serpapiOrganic(json: unknown): Array<{ url: string; title: string }> {
  return asList(asObj(json).organic_results)
    .map((r) => asObj(r))
    .map((r) => ({ url: asStr(r.link), title: asStr(r.title) }))
    .filter((r) => r.url);
}

export function serpapiUrl(input: { phrase: string; country: string; language: string; device: string; location: string }, apiKey: string, start: number): string {
  const params = new URLSearchParams({
    engine: "google",
    q: input.phrase,
    gl: googleGl(input.country),
    hl: googleHl(input.language),
    device: input.device === "mobile" ? "mobile" : "desktop",
    api_key: apiKey,
  });
  // SerpApi matches place names like "Austin, Texas, United States".
  const place = locationParts(input.location, input.country);
  if (place.length) params.set("location", place.join(", "));
  if (start > 0) params.set("start", String(start));
  return `${SERPAPI_ENDPOINT}?${params.toString()}`;
}

export function createSerpApiProvider(options: { apiKey: string; fetch: SerpFetch; timeoutMs?: number }): RankProvider {
  return {
    id: "serpapi",
    name: "SerpApi",
    async check(input) {
      if (!options.apiKey) throw new SerpProviderError("SerpApi: no API key is configured.", "config");
      const collector = new ResultCollector(input);
      const features = new Set<SerpFeature>();
      let requests = 0;
      for (let page = 1; page <= pagesFor(input.depth); page++) {
        const res = await options.fetch({ url: serpapiUrl(input, options.apiKey, (page - 1) * PAGE_SIZE), timeoutMs: options.timeoutMs });
        requests += 1;
        const message = errorMessage(res.json, res.text);
        if (res.status === 200 && message && NO_RESULTS.test(message)) break;
        if (res.status !== 200 || asStr(asObj(res.json).error)) throw httpError("SerpApi", res.status, message);
        if (!res.json || typeof res.json !== "object") throw new SerpProviderError("SerpApi: the response was not JSON.", "response");
        if (page === 1) for (const f of serpapiFeatures(res.json)) features.add(f);
        const items = serpapiOrganic(res.json);
        collector.add(items);
        if (!items.length || collector.done()) break;
      }
      return collector.result(features, requests, requests);
    },
  };
}
