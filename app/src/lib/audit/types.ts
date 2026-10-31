import type { AuditContext, AuditPageData, CrawlSettings } from "@/seo/types";

/**
 * Internal types of the site audit (crawler, parser, checks). The public contract is in
 * src/seo/types.ts; these extend it with the extra facts the crawler stores in
 * audit_pages.data and audits.settings.
 */

/** Everything stored for a page: the contract fields plus extras used by the checks and the UI. */
export interface CrawledPage extends AuditPageData {
  /** Status of the final response after redirects (same as statusCode when not redirected). */
  finalStatus: number | null;
  /** A redirect hop came back to an earlier URL. */
  redirectLoop: boolean;
  /** Counts of <h1>…<h6>. */
  headings: [number, number, number, number, number, number];
  /** <script> elements that run code (JSON-LD and templates excluded). */
  scripts: number;
  /** Stylesheets (<link rel=stylesheet> and <style>). */
  styles: number;
  /** Internal links with rel=nofollow. */
  nofollowLinks: number;
  /** Total <a href> links found (before the stored lists were capped). */
  linksTotal: number;
  /** Images without width/height attributes. */
  imagesWithoutSize: number;
  /** First images (src, alt, size hints) for the page detail. */
  images: Array<{ src: string; alt: string | null; width: string | null; height: string | null }>;
  /** Number of <link rel=canonical> tags. */
  canonicalCount: number;
  /** <meta charset> or http-equiv content type. */
  charset: string;
  /** The URL was listed in the XML sitemap (set while analysing). */
  inSitemap: boolean;
}

/** Site facts gathered when an audit starts (stored in audits.settings → `site`). */
export interface SiteFacts {
  /** Crawl origin after the homepage redirects, e.g. "https://www.example.com". */
  origin: string;
  host: string;
  https: boolean;
  robotsTxt: { found: boolean; valid: boolean; disallowAll: boolean; sitemaps: string[] } | null;
  /** robots.txt text (capped), parsed again by every tick. */
  robotsText: string;
  /** Crawl-delay for our user agent from robots.txt, ms (0 = none). */
  robotsDelayMs: number;
  sitemap: { found: boolean; valid: boolean; urls: number } | null;
  httpRedirectsToHttps: boolean | null;
  /** /favicon.ico answers 200 (null = not checked). */
  faviconIco: boolean | null;
  /** The start URL redirected (e.g. example.com → www.example.com). */
  startRedirectedTo: string | null;
}

/** audits.settings JSON: the crawl settings snapshot plus the site facts once known. */
export interface AuditSettingsJson extends CrawlSettings {
  site?: SiteFacts;
}

/** Context for the checks: the contract's context plus what the crawler knows about the site. */
export interface SiteContext extends AuditContext {
  facts: SiteFacts;
  /** Pages by URL (crawled pages only). */
  pagesByUrl: Map<string, CrawledPage>;
  /** Status of external links checked (sample). */
  externalStatus: Map<string, number | null>;
  /** H1 text (normalised) → URLs that share it. */
  duplicateH1: Map<string, string[]>;
  /** URLs listed in the sitemap that were crawled. */
  sitemapUrls: Set<string>;
  /** URL of the homepage page row. */
  homeUrl: string;
  /** Every URL found was crawled (the page cap was not reached), so inlink counts are complete. */
  complete: boolean;
}

/** What a tick reports. */
export interface TickResult {
  auditId: number;
  /** Pages fetched during this tick. */
  pages: number;
  status: string;
}
