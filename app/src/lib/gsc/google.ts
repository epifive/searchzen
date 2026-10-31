import "server-only";
import { getSettings } from "@/lib/settings";

/**
 * Minimal Google OAuth 2.0 + Search Console API client (no SDK): token exchange and refresh,
 * revocation, sites.list and searchanalytics.query with paging.
 *
 * Endpoints can be pointed at a local mock server for automated tests (never in production):
 *   GOOGLE_OAUTH_BASE=http://127.0.0.1:5431   → {base}/o/oauth2/v2/auth, {base}/token, {base}/revoke, {base}/v1/userinfo
 *   GSC_API_BASE=http://127.0.0.1:5431/webmasters/v3
 */

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const OAUTH_SCOPES = ["openid", "email", GSC_SCOPE] as const;

const TIMEOUT_MS = 20_000;
/** Search Analytics returns at most 25,000 rows per request. */
export const MAX_ROW_LIMIT = 25_000;

export type GoogleErrorKind = "config" | "revoked" | "auth" | "quota" | "permission" | "network" | "response";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly kind: GoogleErrorKind,
    readonly status = 0,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

const trim = (v: string | undefined) => (v ?? "").trim().replace(/\/+$/, "");

export function googleEndpoints() {
  const oauth = trim(process.env.GOOGLE_OAUTH_BASE);
  const api = trim(process.env.GSC_API_BASE);
  return {
    auth: oauth ? `${oauth}/o/oauth2/v2/auth` : "https://accounts.google.com/o/oauth2/v2/auth",
    token: oauth ? `${oauth}/token` : "https://oauth2.googleapis.com/token",
    revoke: oauth ? `${oauth}/revoke` : "https://oauth2.googleapis.com/revoke",
    userinfo: oauth ? `${oauth}/v1/userinfo` : "https://openidconnect.googleapis.com/v1/userinfo",
    api: api || "https://www.googleapis.com/webmasters/v3",
  };
}

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

/** The OAuth client from Admin → Settings → Google, or null when it isn't set up. */
export async function getGoogleCredentials(): Promise<GoogleCredentials | null> {
  const s = await getSettings();
  const clientId = s.google_client_id.trim();
  const clientSecret = s.google_client_secret.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function requireCredentials(): Promise<GoogleCredentials> {
  const c = await getGoogleCredentials();
  if (!c) throw new GoogleApiError("Google sign-in is not configured (Admin → Settings → Google).", "config");
  return c;
}

async function request(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (error) {
    throw new GoogleApiError(`Could not reach Google: ${error instanceof Error ? error.message : "network error"}`, "network");
  }
  const text = await res.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

/** Error of the token endpoint ({ error: "invalid_grant", error_description }). */
function tokenError(status: number, body: Record<string, unknown>): GoogleApiError {
  const code = typeof body.error === "string" ? body.error : "";
  const description = typeof body.error_description === "string" ? body.error_description : code || `HTTP ${status}`;
  if (code === "invalid_grant") return new GoogleApiError(`Google access was revoked or expired: ${description}`, "revoked", status);
  if (code === "invalid_client" || code === "unauthorized_client") return new GoogleApiError(`Google rejected the OAuth client: ${description}`, "config", status);
  if (status === 429) return new GoogleApiError("Google rate limit reached.", "quota", status);
  if (status >= 500) return new GoogleApiError(`Google is unavailable (HTTP ${status}).`, "network", status);
  return new GoogleApiError(`Google token request failed: ${description}`, "response", status);
}

/** Error of a Search Console API call ({ error: { code, message, errors: [{ reason }] } }). */
function apiError(status: number, body: Record<string, unknown>): GoogleApiError {
  const err = (body.error && typeof body.error === "object" ? body.error : {}) as { message?: unknown; errors?: Array<{ reason?: unknown }>; status?: unknown };
  const message = typeof err.message === "string" ? err.message : `HTTP ${status}`;
  const reasons = (Array.isArray(err.errors) ? err.errors : []).map((e) => String(e?.reason ?? ""));
  if (status === 429 || reasons.some((r) => /quota|rateLimit/i.test(r)) || err.status === "RESOURCE_EXHAUSTED") return new GoogleApiError(`Search Console quota reached: ${message}`, "quota", status);
  if (status === 401) return new GoogleApiError(`Google sign-in expired: ${message}`, "auth", status);
  if (status === 403 || status === 404) return new GoogleApiError(`No access to this Search Console property: ${message}`, "permission", status);
  if (status >= 500) return new GoogleApiError(`Search Console is unavailable (HTTP ${status}).`, "network", status);
  return new GoogleApiError(`Search Console request failed: ${message}`, "response", status);
}

/** The consent screen URL (offline access, consent prompt so Google always returns a refresh token). */
export async function buildAuthUrl(state: string, redirectUri: string, loginHint?: string): Promise<string> {
  const { clientId } = await requireCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${googleEndpoints().auth}?${params}`;
}

export interface TokenSet {
  accessToken: string;
  /** Seconds. */
  expiresIn: number;
  refreshToken: string | null;
  scope: string;
  idToken: string | null;
}

function toTokenSet(body: Record<string, unknown>): TokenSet {
  if (typeof body.access_token !== "string" || !body.access_token) throw new GoogleApiError("Google returned no access token.", "response");
  return {
    accessToken: body.access_token,
    expiresIn: Math.max(60, Number(body.expires_in) || 3600),
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    scope: typeof body.scope === "string" ? body.scope : "",
    idToken: typeof body.id_token === "string" ? body.id_token : null,
  };
}

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const { clientId, clientSecret } = await requireCredentials();
  const { status, body } = await request(googleEndpoints().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }).toString(),
  });
  if (status !== 200) throw tokenError(status, body);
  return toTokenSet(body);
}

export function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Revoke a refresh (or access) token at Google. Best effort: never throws. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const { status } = await request(googleEndpoints().revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return status === 200;
  } catch {
    return false;
  }
}

/**
 * The Google account's email: from the id_token returned by the token endpoint (received
 * directly from Google over TLS, so its signature needn't be checked, OpenID Connect § 3.1.3.7),
 * else from the userinfo endpoint.
 */
export async function accountEmail(tokens: TokenSet): Promise<string> {
  if (tokens.idToken) {
    try {
      const payload = JSON.parse(Buffer.from(tokens.idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
      if (typeof payload.email === "string" && payload.email.includes("@")) return payload.email.toLowerCase();
    } catch {
      // Fall back to userinfo.
    }
  }
  const { status, body } = await request(googleEndpoints().userinfo, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" } });
  if (status === 200 && typeof body.email === "string") return body.email.toLowerCase();
  throw new GoogleApiError("Google did not share the account's email address.", "response", status);
}

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

/** Verified properties of the account (sites.list), "sc-domain:" and URL-prefix ones. */
export async function listSites(accessToken: string): Promise<GscSite[]> {
  const { status, body } = await request(`${googleEndpoints().api}/sites`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (status !== 200) throw apiError(status, body);
  const entries = Array.isArray(body.siteEntry) ? (body.siteEntry as Array<Record<string, unknown>>) : [];
  return entries
    .map((e) => ({ siteUrl: String(e.siteUrl ?? ""), permissionLevel: String(e.permissionLevel ?? "") }))
    .filter((s) => s.siteUrl && s.permissionLevel !== "siteUnverifiedUser")
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export type GscDimension = "date" | "query" | "page" | "country" | "device";

export interface GscApiRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface AnalyticsQuery {
  startDate: string;
  endDate: string;
  dimensions: GscDimension[];
  /** Rows per request (≤ 25,000). */
  rowLimit?: number;
  /** Stop paging after this many rows in total. */
  maxRows?: number;
}

/** searchanalytics.query with paging (startRow), final data only. */
export async function queryAnalytics(accessToken: string, siteUrl: string, q: AnalyticsQuery): Promise<GscApiRow[]> {
  const rowLimit = Math.min(MAX_ROW_LIMIT, Math.max(1, q.rowLimit ?? MAX_ROW_LIMIT));
  const maxRows = Math.max(rowLimit, q.maxRows ?? 100_000);
  const url = `${googleEndpoints().api}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const rows: GscApiRow[] = [];
  for (let startRow = 0; startRow < maxRows; startRow += rowLimit) {
    const { status, body } = await request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ startDate: q.startDate, endDate: q.endDate, dimensions: q.dimensions, rowLimit, startRow, dataState: "final", type: "web" }),
    });
    if (status !== 200) throw apiError(status, body);
    const page = Array.isArray(body.rows) ? (body.rows as Array<Record<string, unknown>>) : [];
    for (const r of page) {
      rows.push({
        keys: Array.isArray(r.keys) ? r.keys.map(String) : [],
        clicks: Number(r.clicks) || 0,
        impressions: Number(r.impressions) || 0,
        ctr: Number(r.ctr) || 0,
        position: Number(r.position) || 0,
      });
    }
    if (page.length < rowLimit) break;
  }
  return rows;
}
