import { googleGl, googleHl } from "@/seo/normalize";
import { SerpProviderError, type SerpFeature } from "@/seo/types";
import type { SerpFetch } from "../http";
import { asList, asObj, asStr, errorMessage, httpError, locationParts, pagesFor, present, ResultCollector, type RankProvider } from "../parse";

/**
 * ValueSERP (Traject Data) — GET https://api.valueserp.com/search?api_key=…&q=…
 * One request per page of 10 results (`page=1, 2…`); `device` desktop / mobile, `location` a
 * place name. The credits used are reported in `request_info.credits_used`.
 */

export const VALUESERP_ENDPOINT = "https://api.valueserp.com/search";

export function valueserpFeatures(json: unknown): SerpFeature[] {
  const o = asObj(json);
  const out: SerpFeature[] = [];
  if (present(o.answer_box)) out.push("featured_snippet");
  if (present(o.local_results) || present(o.local_map)) out.push("local_pack");
  if (present(o.ai_overview)) out.push("ai_overview");
  if (present(o.related_questions)) out.push("people_also_ask");
  if (present(o.inline_images)) out.push("images");
  if (present(o.inline_videos)) out.push("videos");
  if (present(o.top_stories)) out.push("top_stories");
  if (present(o.inline_shopping) || present(o.shopping_results)) out.push("shopping");
  if (asList(o.organic_results).some((r) => present(asObj(r).sitelinks))) out.push("sitelinks");
  if (present(o.knowledge_graph)) out.push("knowledge_panel");
  return out;
}

export function valueserpOrganic(json: unknown): Array<{ url: string; title: string }> {
  return asList(asObj(json).organic_results)
    .map((r) => asObj(r))
    .map((r) => ({ url: asStr(r.link), title: asStr(r.title) }))
    .filter((r) => r.url);
}

export function valueserpUrl(input: { phrase: string; country: string; language: string; device: string; location: string }, apiKey: string, page: number): string {
  const params = new URLSearchParams({
    api_key: apiKey,
    q: input.phrase,
    gl: googleGl(input.country),
    hl: googleHl(input.language),
    device: input.device === "mobile" ? "mobile" : "desktop",
  });
  const place = locationParts(input.location, input.country);
  if (place.length) {
    // Google's canonical location names: "Austin,Texas,United States".
    params.set("location", place.join(","));
    // Keep the keyword's country and language even when the location is a known place.
    params.set("location_auto", "false");
  }
  if (page > 1) params.set("page", String(page));
  return `${VALUESERP_ENDPOINT}?${params.toString()}`;
}

export function createValueSerpProvider(options: { apiKey: string; fetch: SerpFetch; timeoutMs?: number }): RankProvider {
  return {
    id: "valueserp",
    name: "ValueSERP",
    async check(input) {
      if (!options.apiKey) throw new SerpProviderError("ValueSERP: no API key is configured.", "config");
      const collector = new ResultCollector(input);
      const features = new Set<SerpFeature>();
      let requests = 0;
      let credits = 0;
      for (let page = 1; page <= pagesFor(input.depth); page++) {
        const res = await options.fetch({ url: valueserpUrl(input, options.apiKey, page), timeoutMs: options.timeoutMs });
        requests += 1;
        const info = asObj(asObj(res.json).request_info);
        if (res.status !== 200 || info.success === false) {
          throw httpError("ValueSERP", res.status === 200 ? 400 : res.status, asStr(info.message) || errorMessage(res.json, res.text));
        }
        if (!res.json || typeof res.json !== "object") throw new SerpProviderError("ValueSERP: the response was not JSON.", "response");
        credits += Number(info.credits_used) || 1;
        if (page === 1) for (const f of valueserpFeatures(res.json)) features.add(f);
        const items = valueserpOrganic(res.json);
        collector.add(items);
        if (!items.length || collector.done()) break;
      }
      return collector.result(features, requests, credits);
    },
  };
}
