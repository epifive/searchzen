import type { AuditCheck } from "@/seo/types";
import { htmlOk, indexable, pageCheck, siteCheck } from "./helpers";

/** Performance, technical markup and social sharing tags. */

export const LARGE_HTML_BYTES = 1024 * 1024;
export const SLOW_TTFB_MS = 1500;
export const MAX_SCRIPTS = 25;
const OG_REQUIRED = ["og:title", "og:description", "og:image"];

export const PERFORMANCE_CHECKS: AuditCheck[] = [
  pageCheck("large_html", "warning", "performance", (p) => p.isHtml && p.sizeBytes > LARGE_HTML_BYTES && { bytes: p.sizeBytes }),
  pageCheck("slow_ttfb", "warning", "performance", (p) => p.statusCode !== null && p.ttfbMs > SLOW_TTFB_MS && { ms: p.ttfbMs }),
  pageCheck("no_compression", "notice", "performance", (p) => htmlOk(p) && p.sizeBytes > 1024 && !/\b(gzip|br|deflate|zstd|compress)\b/i.test(p.encoding)),
  pageCheck("too_many_scripts", "notice", "performance", (p) => htmlOk(p) && p.scripts > MAX_SCRIPTS && { count: p.scripts }),
];

export const TECHNICAL_CHECKS: AuditCheck[] = [
  pageCheck("viewport_missing", "warning", "technical", (p) => htmlOk(p) && !p.viewport),
  pageCheck("lang_missing", "notice", "technical", (p) => htmlOk(p) && !p.lang),
  pageCheck("mixed_content", "warning", "technical", (p) => htmlOk(p) && p.mixedContent.length > 0 && { count: p.mixedContent.length, url: p.mixedContent[0] }),
  pageCheck("jsonld_invalid", "warning", "technical", (p) => htmlOk(p) && p.jsonLd.some((j) => !j.valid) && { count: p.jsonLd.filter((j) => !j.valid).length }),
  pageCheck("no_structured_data", "notice", "technical", (p) => indexable(p) && p.jsonLd.length === 0),
  siteCheck("favicon_missing", "notice", "technical", (ctx) => {
    const home = ctx.pagesByUrl.get(ctx.homeUrl);
    if (!home || !htmlOk(home) || home.favicon) return false;
    return ctx.facts.faviconIco === false;
  }),
];

export const SOCIAL_CHECKS: AuditCheck[] = [
  pageCheck("og_missing", "notice", "social", (p) => {
    if (!indexable(p)) return false;
    const missing = OG_REQUIRED.filter((k) => !p.openGraph[k]);
    return missing.length > 0 && { missing: missing.join(", ") };
  }),
  pageCheck("twitter_card_missing", "notice", "social", (p) => indexable(p) && !p.twitterCard["twitter:card"]),
];
