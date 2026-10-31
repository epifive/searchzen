import type { AuditCheck } from "@/seo/types";
import { sameDocument } from "../url";
import { canonicalElsewhere, effectiveStatus, htmlOk, isNofollow, isNoindex, pageCheck, siteCheck } from "./helpers";

/** Can search engines reach and index the pages: status codes, redirects, HTTPS, robots, canonicals, sitemaps, hreflang. */

const HREFLANG = /^([a-z]{2,3})(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/i;

/** hreflang value Google accepts: "x-default" or language[-Script][-REGION] with valid subtags. */
export function validHreflang(value: string): boolean {
  const v = value.trim();
  if (v.toLowerCase() === "x-default") return true;
  const m = HREFLANG.exec(v);
  if (!m) return false;
  // Common mistakes: "en-UK" (the code is GB) and "en-EU" (no such country).
  const region = (m[4] ?? "").toUpperCase();
  if (region === "UK" || region === "EU") return false;
  try {
    return Intl.getCanonicalLocales(v).length === 1;
  } catch {
    return false;
  }
}

export const INDEXABILITY_CHECKS: AuditCheck[] = [
  pageCheck("http_4xx", "critical", "indexability", (p) => p.statusCode !== null && p.statusCode >= 400 && p.statusCode < 500 && { status: p.statusCode }),
  pageCheck("http_5xx", "critical", "indexability", (p) => p.statusCode !== null && p.statusCode >= 500 && { status: p.statusCode }),
  pageCheck("fetch_error", "critical", "indexability", (p) => p.statusCode === null && !p.redirectLoop && { error: p.error ?? "" }),
  pageCheck("redirect_loop", "critical", "indexability", (p) => p.redirectLoop && { hops: p.redirects.length }),
  pageCheck("redirect_chain", "warning", "indexability", (p) => !p.redirectLoop && p.redirects.length > 1 && { hops: p.redirects.length, target: p.finalUrl }),
  pageCheck("http_page", "warning", "indexability", (p, ctx) => ctx.facts.https && p.url.startsWith("http:") && p.statusCode === 200),
  siteCheck("no_https", "critical", "indexability", (ctx) => !ctx.facts.https),
  siteCheck("no_https_redirect", "warning", "indexability", (ctx) => ctx.facts.https && ctx.facts.httpRedirectsToHttps === false),
  pageCheck("noindex", "warning", "indexability", (p) => htmlOk(p) && isNoindex(p) && { source: /\b(noindex|none)\b/.test(p.xRobotsTag) ? "X-Robots-Tag" : "meta robots" }),
  pageCheck("nofollow_page", "notice", "indexability", (p) => htmlOk(p) && isNofollow(p)),
  pageCheck("canonical_missing", "notice", "indexability", (p) => htmlOk(p) && !isNoindex(p) && !p.canonical),
  pageCheck("canonical_other", "notice", "indexability", (p) => htmlOk(p) && canonicalElsewhere(p) && { target: p.canonical ?? "" }),
  pageCheck("canonical_broken", "critical", "indexability", (p, ctx) => {
    if (!htmlOk(p) || !p.canonical || sameDocument(p.canonical, p.url)) return false;
    const status = effectiveStatus(ctx, p.canonical);
    const target = ctx.pagesByUrl.get(p.canonical);
    // A canonical that redirects is as bad as a broken one: point it at the final URL.
    const first = target ? target.statusCode : status;
    if (first === undefined || first === 200) return false;
    return { target: p.canonical, status: first === null ? "error" : first };
  }),
  siteCheck("robots_txt_missing", "warning", "indexability", (ctx) => ctx.robotsTxt !== null && !ctx.robotsTxt.found),
  siteCheck("robots_txt_invalid", "warning", "indexability", (ctx) => Boolean(ctx.robotsTxt?.found && !ctx.robotsTxt.valid)),
  siteCheck("robots_txt_blocks_all", "critical", "indexability", (ctx) => Boolean(ctx.robotsTxt?.found && ctx.robotsTxt.disallowAll)),
  siteCheck("sitemap_missing", "warning", "indexability", (ctx) => ctx.sitemap !== null && !ctx.sitemap.found),
  siteCheck("sitemap_invalid", "warning", "indexability", (ctx) => Boolean(ctx.sitemap?.found && !ctx.sitemap.valid) && { urls: ctx.sitemap?.urls ?? 0 }),
  pageCheck("sitemap_bad_url", "warning", "indexability", (p) => p.inSitemap && p.statusCode !== 200 && { status: p.statusCode ?? "error" }),
  pageCheck("hreflang_invalid", "warning", "indexability", (p) => {
    if (!htmlOk(p)) return false;
    const bad = p.hreflang.filter((h) => !validHreflang(h.lang) || !h.href);
    return bad.length > 0 && { count: bad.length, value: bad[0].lang || "(empty)" };
  }),
  pageCheck("hreflang_no_self", "notice", "indexability", (p) => htmlOk(p) && p.hreflang.length > 0 && !p.hreflang.some((h) => h.href && sameDocument(h.href, p.url))),
  pageCheck("hreflang_no_return", "warning", "indexability", (p, ctx) => {
    if (!htmlOk(p) || !p.hreflang.length) return false;
    const missing: string[] = [];
    for (const alt of p.hreflang) {
      if (!alt.href || sameDocument(alt.href, p.url)) continue;
      const target = ctx.pagesByUrl.get(alt.href);
      if (!target || !htmlOk(target)) continue;
      if (!target.hreflang.some((h) => h.href && sameDocument(h.href, p.url))) missing.push(alt.href);
    }
    return missing.length > 0 && { count: missing.length, url: missing[0] };
  }),
];
