import "server-only";
import net from "node:net";
import zlib from "node:zlib";
import { Agent, fetch as undiciFetch } from "undici";
import { guardedLookup, isPrivateAddress } from "@/lib/net/ssrf";
import type { UserAgentMode } from "@/seo/types";

/**
 * HTTP client of the site audit crawler. Same SSRF guards as the rest of the app
 * (src/lib/net/ssrf.ts): the IP is checked when the socket connects (no private, loopback or
 * link-local addresses, which also defeats DNS rebinding), only standard web ports, no
 * credentials in URLs. Redirects are followed by hand so every hop is validated and recorded.
 *
 * ALLOW_PRIVATE_CRAWL=true turns the private-address guard off. It exists ONLY for automated
 * tests against a local fixture site (127.0.0.1); never set it on a public installation, or any
 * customer could make the server crawl your internal network.
 */

export const MAX_HTML_BYTES = 3 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

export function allowPrivateCrawl(): boolean {
  const v = process.env.ALLOW_PRIVATE_CRAWL?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

const guardedAgent = new Agent({ connect: { lookup: guardedLookup, timeout: 8_000 }, headersTimeout: REQUEST_TIMEOUT_MS, bodyTimeout: 15_000, connections: 8 });
let openAgent: Agent | null = null;
const agent = () => (allowPrivateCrawl() ? (openAgent ??= new Agent({ connect: { timeout: 8_000 }, headersTimeout: REQUEST_TIMEOUT_MS, bodyTimeout: 15_000 })) : guardedAgent);

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** User-Agent header for a crawl: "SearchzenBot/1.0 (+site URL)" or a desktop Chrome string. */
export function crawlerUserAgent(mode: UserAgentMode, siteUrl: string): string {
  return mode === "browser" ? BROWSER_UA : `SearchzenBot/1.0 (+${siteUrl.replace(/\/+$/, "")})`;
}

/** Why a URL may not be fetched, or "" when it may. */
export function blockedReason(url: URL): string {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http:// and https:// URLs are crawled.";
  if (url.username || url.password) return "URLs with credentials are not crawled.";
  if (allowPrivateCrawl()) return "";
  if (!ALLOWED_PORTS.has(url.port)) return "Only standard web ports (80, 443, 8080, 8443) are crawled.";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(host)) return isPrivateAddress(host) ? "Private and local addresses are not crawled." : "";
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "Private and local addresses are not crawled.";
  return "";
}

export interface FetchResult {
  url: string;
  /** null = no HTTP answer (see error). */
  status: number | null;
  headers: Record<string, string>;
  body: Buffer | null;
  /** Bytes read (decoded); the full size when known from Content-Length for unread bodies. */
  bytes: number;
  truncated: boolean;
  ttfbMs: number;
  loadMs: number;
  error: string | null;
}

export interface FetchOptions {
  userAgent: string;
  method?: "GET" | "HEAD";
  /** Read the body only for these responses (default: every response). */
  readBody?: (status: number, contentType: string) => boolean;
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
}

function networkError(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code ?? "";
  if (code === "EBLOCKED") return "Blocked: private or local address.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS lookup failed.";
  if (code === "ECONNREFUSED") return "Connection refused.";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "Connection reset.";
  if (err.name === "TimeoutError" || err.name === "AbortError" || code.includes("TIMEOUT")) return "Timed out.";
  if (/CERT|SSL|TLS/i.test(code)) return `TLS/SSL error (${code}).`;
  return code ? `Connection failed (${code}).` : "Connection failed.";
}

/** One request, redirects not followed. Never throws. */
export async function fetchOnce(input: string, options: FetchOptions): Promise<FetchResult> {
  const started = Date.now();
  const empty = (error: string): FetchResult => ({ url: input, status: null, headers: {}, body: null, bytes: 0, truncated: false, ttfbMs: 0, loadMs: Date.now() - started, error });
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return empty("Invalid URL.");
  }
  const blocked = blockedReason(url);
  if (blocked) return empty(blocked);
  const method = options.method ?? "GET";
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS + 5_000);
  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    res = await undiciFetch(url, {
      method,
      redirect: "manual",
      dispatcher: agent(),
      headers: {
        "User-Agent": options.userAgent,
        Accept: options.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en;q=0.9,*;q=0.5",
      },
      signal: timeout,
    });
  } catch (e) {
    return empty(networkError(e));
  }
  const ttfbMs = Date.now() - started;
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const contentType = headers["content-type"] ?? "";
  const wantBody = method === "GET" && (options.readBody ? options.readBody(res.status, contentType) : true);
  if (!wantBody) {
    await res.body?.cancel().catch(() => undefined);
    const length = Number(headers["content-length"]);
    return { url: url.toString(), status: res.status, headers, body: null, bytes: Number.isFinite(length) ? length : 0, truncated: false, ttfbMs, loadMs: Date.now() - started, error: null };
  }
  const max = options.maxBytes ?? MAX_HTML_BYTES;
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  let error: string | null = null;
  try {
    if (res.body) {
      for await (const chunk of res.body) {
        const piece = Buffer.from(chunk as Uint8Array);
        bytes += piece.byteLength;
        if (bytes > max) {
          truncated = true;
          chunks.push(piece.subarray(0, Math.max(0, piece.byteLength - (bytes - max))));
          break;
        }
        chunks.push(piece);
      }
    }
  } catch (e) {
    error = networkError(e);
  }
  if (truncated) await res.body?.cancel().catch(() => undefined);
  return { url: url.toString(), status: res.status, headers, body: Buffer.concat(chunks), bytes, truncated, ttfbMs, loadMs: Date.now() - started, error };
}

export interface RedirectResult {
  /** Every hop that answered with a redirect (url + status), in order. */
  hops: Array<{ url: string; status: number }>;
  final: FetchResult;
  loop: boolean;
  tooMany: boolean;
  /** TTFB of the first request (the URL asked for), ms. */
  firstTtfbMs: number;
  /** Time for the whole chain, ms. */
  totalMs: number;
}

/**
 * GET with redirects followed by hand (each hop validated). Never throws.
 * `firstHopBodyOnly`: read the body only when the first URL answers directly (no redirect).
 */
export async function fetchFollow(input: string, options: FetchOptions & { maxRedirects?: number; firstHopBodyOnly?: boolean }): Promise<RedirectResult> {
  const started = Date.now();
  const hops: Array<{ url: string; status: number }> = [];
  const seen = new Set<string>();
  let url = input;
  let firstTtfbMs = 0;
  const max = options.maxRedirects ?? 10;
  for (let i = 0; ; i++) {
    seen.add(url);
    const res = await fetchOnce(url, {
      ...options,
      readBody: (status, type) => !(status >= 300 && status < 400) && (i === 0 || !options.firstHopBodyOnly) && (options.readBody ? options.readBody(status, type) : true),
    });
    if (i === 0) firstTtfbMs = res.ttfbMs;
    const done = (final: FetchResult, loop = false, tooMany = false): RedirectResult => ({ hops, final, loop, tooMany, firstTtfbMs, totalMs: Date.now() - started });
    const location = res.headers.location;
    if (res.status !== null && res.status >= 300 && res.status < 400 && location) {
      hops.push({ url, status: res.status });
      let next: string;
      try {
        next = new URL(location, url).toString().replace(/#.*$/, "");
      } catch {
        return done({ ...res, error: "Invalid redirect location." });
      }
      if (seen.has(next)) return done({ ...res, url: next, error: "Redirect loop." }, true);
      if (i >= max) return done({ ...res, url: next, error: "Too many redirects." }, false, true);
      url = next;
      continue;
    }
    return done(res);
  }
}

/** Text of a body in its declared charset (UTF-8 by default); gzip files (sitemap.xml.gz) are inflated. */
export function bodyText(res: Pick<FetchResult, "body" | "headers">, maxInflated = 20 * 1024 * 1024): string {
  let body = res.body;
  if (!body?.length) return "";
  if (body[0] === 0x1f && body[1] === 0x8b) {
    try {
      body = zlib.gunzipSync(body, { maxOutputLength: maxInflated });
    } catch {
      return "";
    }
  }
  const declared = /charset=["']?([\w.:-]+)/i.exec(res.headers["content-type"] ?? "")?.[1];
  let charset = declared;
  if (!charset) {
    const head = body.subarray(0, 2048).toString("latin1");
    charset = /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(head)?.[1] ?? /encoding=["']([\w.:-]+)["']/i.exec(head)?.[1] ?? "utf-8";
  }
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** True for HTML responses. */
export function isHtmlType(contentType: string): boolean {
  return /\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}
