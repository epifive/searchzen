import type { AuditCheck } from "@/seo/types";
import { effectiveStatus, htmlOk, isBroken, pageCheck } from "./helpers";

/** Links and URLs: broken links, links to redirects, link counts, URL hygiene and site structure. */

export const MAX_LINKS = 150;
export const MAX_URL_CHARS = 115;
export const MAX_DEPTH = 4;

/** External statuses that mean "gone": 404 / 410, server errors and dead hosts. 401/403/429/999 are bot blocks, not broken links. */
const externalBroken = (status: number | null | undefined) => status === null || status === 404 || status === 410 || (typeof status === "number" && status >= 500);

export const LINK_CHECKS: AuditCheck[] = [
  pageCheck("broken_internal_link", "critical", "links", (p, ctx) => {
    if (!htmlOk(p)) return false;
    let count = 0;
    let first = "";
    let firstStatus: number | string = "";
    for (const link of p.internalLinks) {
      const status = effectiveStatus(ctx, link);
      if (status === undefined || !isBroken(status)) continue;
      if (!count) {
        first = link;
        firstStatus = status ?? "error";
      }
      count++;
    }
    return count > 0 && { count, url: first, status: firstStatus };
  }),
  pageCheck("broken_external_link", "warning", "links", (p, ctx) => {
    if (!htmlOk(p)) return false;
    let count = 0;
    let first = "";
    let firstStatus: number | string = "";
    for (const link of p.externalLinks) {
      if (!ctx.externalStatus.has(link)) continue;
      const status = ctx.externalStatus.get(link);
      if (!externalBroken(status)) continue;
      if (!count) {
        first = link;
        firstStatus = status ?? "error";
      }
      count++;
    }
    return count > 0 && { count, url: first, status: firstStatus };
  }),
  pageCheck("internal_redirect_link", "notice", "links", (p, ctx) => {
    if (!htmlOk(p)) return false;
    const targets = p.internalLinks.filter((l) => {
      const page = ctx.pagesByUrl.get(l);
      return page && page.redirects.length > 0;
    });
    return targets.length > 0 && { count: targets.length, url: targets[0] };
  }),
  pageCheck("too_many_links", "notice", "links", (p) => htmlOk(p) && p.linksTotal > MAX_LINKS && { count: p.linksTotal }),
  pageCheck("url_uppercase", "notice", "links", (p) => htmlOk(p) && /[A-Z]/.test(new URL(p.url).pathname)),
  pageCheck("url_underscores", "notice", "links", (p) => htmlOk(p) && new URL(p.url).pathname.includes("_")),
  pageCheck("url_params", "notice", "links", (p) => htmlOk(p) && new URL(p.url).search.length > 1),
  pageCheck("url_too_long", "notice", "links", (p) => htmlOk(p) && p.url.length > MAX_URL_CHARS && { length: p.url.length }),
  // Only when every URL found was crawled: with the page cap reached, the links to a page may sit on pages not crawled.
  pageCheck("orphan_page", "warning", "links", (p, ctx) => ctx.complete && htmlOk(p) && p.inSitemap && p.inlinks === 0 && p.url !== ctx.homeUrl),
  pageCheck("deep_page", "notice", "links", (p) => htmlOk(p) && p.depth > MAX_DEPTH && { depth: p.depth }),
];
