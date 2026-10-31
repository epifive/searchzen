import { googleGl, googleHl } from "@/seo/normalize";
import { SerpProviderError, type SerpFeature } from "@/seo/types";
import type { SerpFetch } from "../http";
import { asList, asObj, asStr, errorMessage, httpError, locationParts, pagesFor, PAGE_SIZE, present, ResultCollector, type RankProvider } from "../parse";

/**
 * Serper.dev — POST https://google.serper.dev/search with the X-API-KEY header.
 * One request per page of 10 results (`num: 10`, `page: 1, 2…`); 1 credit each. Serper reports
 * the credits used in every response. Results are desktop results (Serper has no device option).
 */

export const SERPER_ENDPOINT = "https://google.serper.dev/search";

export function serperFeatures(json: unknown): SerpFeature[] {
  const o = asObj(json);
  const out: SerpFeature[] = [];
  if (present(o.answerBox)) out.push("featured_snippet");
  if (present(o.places) || present(o.localResults)) out.push("local_pack");
  if (present(o.aiOverview)) out.push("ai_overview");
  if (present(o.peopleAlsoAsk)) out.push("people_also_ask");
  if (present(o.images)) out.push("images");
  if (present(o.videos)) out.push("videos");
  if (present(o.topStories)) out.push("top_stories");
  if (present(o.shopping)) out.push("shopping");
  if (asList(o.organic).some((r) => present(asObj(r).sitelinks))) out.push("sitelinks");
  if (present(o.knowledgeGraph)) out.push("knowledge_panel");
  return out;
}

export function serperOrganic(json: unknown): Array<{ url: string; title: string }> {
  return asList(asObj(json).organic)
    .map((r) => asObj(r))
    .map((r) => ({ url: asStr(r.link), title: asStr(r.title) }))
    .filter((r) => r.url);
}

export function createSerperProvider(options: { apiKey: string; fetch: SerpFetch; timeoutMs?: number }): RankProvider {
  return {
    id: "serper",
    name: "Serper.dev",
    async check(input) {
      if (!options.apiKey) throw new SerpProviderError("Serper.dev: no API key is configured.", "config");
      const collector = new ResultCollector(input);
      const features = new Set<SerpFeature>();
      let requests = 0;
      let credits = 0;
      // Serper matches place names like "Austin, Texas, United States".
      const place = locationParts(input.location, input.country).join(", ");
      for (let page = 1; page <= pagesFor(input.depth); page++) {
        const body: Record<string, string | number> = { q: input.phrase, gl: googleGl(input.country), hl: googleHl(input.language), num: PAGE_SIZE, page };
        if (place) body.location = place;
        const res = await options.fetch({
          url: SERPER_ENDPOINT,
          method: "POST",
          headers: { "X-API-KEY": options.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          timeoutMs: options.timeoutMs,
        });
        requests += 1;
        if (res.status !== 200) throw httpError("Serper.dev", res.status, errorMessage(res.json, res.text));
        if (!res.json || typeof res.json !== "object") throw new SerpProviderError("Serper.dev: the response was not JSON.", "response");
        credits += Number(asObj(res.json).credits) || 1;
        if (page === 1) for (const f of serperFeatures(res.json)) features.add(f);
        const items = serperOrganic(res.json);
        collector.add(items);
        if (!items.length || collector.done()) break;
      }
      return collector.result(features, requests, credits);
    },
  };
}
