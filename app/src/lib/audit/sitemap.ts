import "server-only";
import { bodyText, fetchFollow } from "./fetch";
import { decodeEntities } from "./parse";
import { normalizeUrl } from "./url";

/**
 * XML sitemaps: reads the sitemaps named in robots.txt (or /sitemap.xml, then
 * /sitemap_index.xml), follows sitemap indexes, and returns the page URLs they list. Also
 * plain-text sitemaps (one URL per line) and gzip files are understood.
 */

export interface SitemapResult {
  /** At least one sitemap answered 200. */
  found: boolean;
  /** Every sitemap that answered was a well-formed urlset / sitemapindex (or a text list). */
  valid: boolean;
  /** Page URLs listed (unique, normalised), at most `maxUrls`. */
  urls: string[];
  /** Page URLs listed in total (also beyond maxUrls). */
  total: number;
  /** Sitemap files read. */
  files: string[];
}

const LOC = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi;
const MAX_SITEMAP_BYTES = 12 * 1024 * 1024;

export function parseSitemap(text: string): { kind: "urlset" | "index" | "text" | "invalid"; locs: string[] } {
  const head = text.slice(0, 4000).toLowerCase();
  const locs: string[] = [];
  if (head.includes("<urlset") || head.includes("<sitemapindex")) {
    for (const m of text.matchAll(LOC)) locs.push(decodeEntities(m[1]).trim());
    const kind = /<sitemapindex[\s>]/i.test(text.slice(0, 4000)) ? "index" : "urlset";
    // A truncated / broken file has no closing root tag.
    const closed = kind === "index" ? /<\/sitemapindex\s*>/i.test(text) : /<\/urlset\s*>/i.test(text);
    return { kind: closed ? kind : "invalid", locs };
  }
  if (/^\s*</.test(text)) return { kind: "invalid", locs };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length && lines.every((l) => /^https?:\/\/\S+$/i.test(l))) return { kind: "text", locs: lines };
  return { kind: "invalid", locs };
}

export async function readSitemaps(
  candidates: string[],
  options: { userAgent: string; deadline: number; maxFiles?: number; maxUrls: number; fallbacks?: string[] },
): Promise<SitemapResult> {
  const result: SitemapResult = { found: false, valid: true, urls: [], total: 0, files: [] };
  const seenUrls = new Set<string>();
  const queue = [...candidates];
  const fallbacks = [...(options.fallbacks ?? [])];
  const done = new Set<string>();
  const maxFiles = options.maxFiles ?? 10;
  while (result.files.length < maxFiles && Date.now() < options.deadline) {
    const next = queue.shift() ?? (!result.found ? fallbacks.shift() : undefined);
    if (!next) break;
    const url = normalizeUrl(next);
    if (!url || done.has(url)) continue;
    done.add(url);
    const { final } = await fetchFollow(url, { userAgent: options.userAgent, maxBytes: MAX_SITEMAP_BYTES, accept: "application/xml,text/xml;q=0.9,*/*;q=0.5", maxRedirects: 5 });
    if (final.status !== 200 || final.error) continue;
    result.found = true;
    result.files.push(url);
    const parsed = parseSitemap(bodyText(final));
    if (parsed.kind === "invalid") {
      result.valid = false;
      continue;
    }
    if (parsed.kind === "index") {
      for (const loc of parsed.locs) if (queue.length < 200) queue.push(loc);
      continue;
    }
    for (const loc of parsed.locs) {
      const page = normalizeUrl(loc);
      if (!page || seenUrls.has(page)) continue;
      seenUrls.add(page);
      result.total++;
      if (result.urls.length < options.maxUrls) result.urls.push(page);
    }
  }
  if (!result.found) result.valid = false;
  return result;
}
