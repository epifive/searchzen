import type { AuditCheck, AuditIssueFinding, IssueCategory, Severity } from "@/seo/types";
import type { CrawledPage, SiteContext } from "../types";

/** Facts stored with an issue (shown next to the affected page). */
export type Details = Record<string, string | number | boolean>;
type Result = Details | boolean | null | undefined;

const finding = (code: string, r: Result): AuditIssueFinding | null => (r ? (r === true ? { code } : { code, details: r }) : null);

/** A page-level check. `test` returns true / details when the page has the issue. */
export function pageCheck(code: string, severity: Severity, category: IssueCategory, test: (page: CrawledPage, ctx: SiteContext) => Result): AuditCheck {
  return {
    code,
    severity,
    category,
    titleKey: `audit.issue.${code}`,
    test: (page, ctx) => finding(code, test(page as CrawledPage, ctx as SiteContext)),
  };
}

/** A site-level check, run once per audit after the crawl. */
export function siteCheck(code: string, severity: Severity, category: IssueCategory, test: (ctx: SiteContext, pages: CrawledPage[]) => Result): AuditCheck {
  return {
    code,
    severity,
    category,
    titleKey: `audit.issue.${code}`,
    testSite: (ctx, pages) => finding(code, test(ctx as SiteContext, pages as CrawledPage[])),
  };
}

/** An HTML page that answered 200 (content checks only look at these). */
export const htmlOk = (p: CrawledPage) => p.isHtml && p.statusCode === 200;

export const isNoindex = (p: Pick<CrawledPage, "robotsMeta" | "xRobotsTag">) => /\b(noindex|none)\b/.test(`${p.robotsMeta} ${p.xRobotsTag}`);
export const isNofollow = (p: Pick<CrawledPage, "robotsMeta" | "xRobotsTag">) => /\b(nofollow|none)\b/.test(`${p.robotsMeta} ${p.xRobotsTag}`);

/** The canonical names another URL. */
export function canonicalElsewhere(p: CrawledPage): boolean {
  if (!p.canonical) return false;
  try {
    const a = new URL(p.canonical);
    const b = new URL(p.url);
    a.hash = "";
    b.hash = "";
    return a.toString() !== b.toString();
  } catch {
    return true;
  }
}

/** Indexable HTML page: 200, no noindex, canonical to itself (or none). Duplicate / content checks use these. */
export const indexable = (p: CrawledPage) => htmlOk(p) && !isNoindex(p) && !canonicalElsewhere(p);

/** Status a link to `url` ends at: the final status for redirects, undefined when the URL was not crawled. */
export function effectiveStatus(ctx: SiteContext, url: string): number | null | undefined {
  const page = ctx.pagesByUrl.get(url);
  if (!page) return ctx.statusByUrl.has(url) ? ctx.statusByUrl.get(url) : undefined;
  if (page.redirectLoop) return null;
  return page.redirects.length ? page.finalStatus : page.statusCode;
}

export const isBroken = (status: number | null | undefined) => status === null || (typeof status === "number" && status >= 400);

/** Text key for duplicate detection: case- and space-insensitive. */
export const dupKey = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Character length as people count it (emoji and accents count once). */
export const textLength = (s: string) => [...s].length;
