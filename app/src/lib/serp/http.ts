import "server-only";
import { Agent, fetch as undiciFetch } from "undici";
import { guardedLookup } from "@/lib/net/ssrf";
import { SerpProviderError } from "@/seo/types";

/**
 * HTTP for SERP provider APIs: public addresses only (the same private-address guard as every
 * other outgoing request), a timeout per request and a size cap on the response.
 * Providers receive a SerpFetch so tests can replay recorded responses instead.
 */

export interface SerpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface SerpResponse {
  status: number;
  /** Parsed JSON body, or null when the body is not JSON. */
  json: unknown;
  text: string;
}

export type SerpFetch = (request: SerpRequest) => Promise<SerpResponse>;

const MAX_BYTES = 6 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

const agent = new Agent({ connect: { lookup: guardedLookup, timeout: 10_000 }, headersTimeout: 25_000, bodyTimeout: 25_000 });

/** The real fetch used in production. Throws SerpProviderError("network") on connection problems. */
export const serpFetch: SerpFetch = async (request) => {
  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    res = await undiciFetch(request.url, {
      method: request.method ?? "GET",
      dispatcher: agent,
      redirect: "follow",
      headers: { "User-Agent": "Searchzen/1.0 (rank tracker)", Accept: "application/json", ...request.headers },
      body: request.body,
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    const host = (() => {
      try {
        return new URL(request.url).host;
      } catch {
        return "the provider";
      }
    })();
    if (name === "TimeoutError" || name === "AbortError") throw new SerpProviderError(`${host} did not answer in time.`, "network");
    throw new SerpProviderError(`Could not connect to ${host}.`, "network");
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (res.body) {
    for await (const chunk of res.body) {
      const piece = chunk as Uint8Array;
      bytes += piece.byteLength;
      if (bytes > MAX_BYTES) {
        await res.body.cancel().catch(() => undefined);
        throw new SerpProviderError("The provider's response was too large.", "response");
      }
      chunks.push(piece);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
};
