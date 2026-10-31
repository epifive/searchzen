import crypto from "node:crypto";

/** URL helpers of the crawler: normalisation, same-site tests and hashes. */

export const MAX_URL_LENGTH = 1000;

/**
 * An absolute http(s) URL in the form the crawler stores it: lower-case scheme and host,
 * no default port, no fragment, no credentials. Relative links are resolved against `base`.
 * null for other schemes (mailto:, javascript:, data:…), invalid or very long URLs.
 */
export function normalizeUrl(href: string, base?: string | URL): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#")) return null;
  if (/^(mailto|tel|javascript|data|sms|ftp|file|about|blob|whatsapp|skype|callto|intent):/i.test(raw)) return null;
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  const out = url.toString();
  return out.length > MAX_URL_LENGTH ? null : out;
}

/** Host without a leading "www." (lower case). */
export function bareHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** True when `url` is on the crawled site: the same host, with or without "www.". */
export function isSameSite(url: string | URL, host: string): boolean {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    return bareHost(u.hostname) === bareHost(host);
  } catch {
    return false;
  }
}

/** Path with query ("/blog?page=2") of an absolute URL, for include / exclude patterns and robots.txt. */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return "/";
  }
}

/** sha256 hex of a URL (audit_pages.url_hash / audit_queue.url_hash). */
export function urlHash(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex");
}

/** Both strings name the same URL once normalised (used to compare canonicals with the page URL). */
export function sameDocument(a: string, b: string): boolean {
  const na = normalizeUrl(a);
  return na !== null && na === normalizeUrl(b);
}
