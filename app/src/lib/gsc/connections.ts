import "server-only";
import { logAlert } from "@/lib/channels";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, now } from "@/lib/db";
import type { GscConnection } from "@/lib/db/schema";
import { emailTranslator } from "@/lib/i18n/email";
import { mailConfigured, sendMail } from "@/lib/mail";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { GoogleApiError, listSites, refreshAccessToken, revokeToken, type GscSite } from "./google";

/**
 * Google accounts connected for Search Console (gsc_connections). The refresh token is stored
 * encrypted (AES-256-GCM, src/lib/crypto.ts); access tokens live in memory only. A connection
 * whose refresh token Google rejects (revoked access, changed password, 6 months unused) is
 * marked broken (last_error = "revoked") and its owner is told once by email; imports stop
 * until the user reconnects the same Google account.
 */

const TOKEN_PURPOSE = "gsc-refresh-token";
export const REVOKED = "revoked";

export interface GscConnectionRecord {
  id: number;
  userId: number;
  email: string;
  scopes: string;
  /** Google rejected the refresh token: the user must reconnect. */
  broken: boolean;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toConnectionRecord(row: GscConnection): GscConnectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.google_email,
    scopes: row.scopes,
    broken: row.last_error === REVOKED,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserConnections(userId: number): Promise<GscConnectionRecord[]> {
  const db = await getDb();
  const rows = await db.selectFrom("gsc_connections").selectAll().where("user_id", "=", userId).orderBy("id").execute();
  return rows.map(toConnectionRecord);
}

export async function getOwnedConnection(id: number, userId: number): Promise<GscConnectionRecord | undefined> {
  if (!Number.isInteger(id) || id < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("gsc_connections").selectAll().where("id", "=", id).where("user_id", "=", userId).executeTakeFirst();
  return row ? toConnectionRecord(row) : undefined;
}

export async function getConnection(id: number): Promise<GscConnectionRecord | undefined> {
  const db = await getDb();
  const row = await db.selectFrom("gsc_connections").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? toConnectionRecord(row) : undefined;
}

/** Store (or refresh) the user's connection for a Google account. Returns its id. */
export async function saveConnection(userId: number, email: string, refreshToken: string, scopes: string): Promise<number> {
  const db = await getDb();
  const encrypted = await encryptSecret(refreshToken, TOKEN_PURPOSE);
  const ts = now();
  const existing = await db.selectFrom("gsc_connections").select("id").where("user_id", "=", userId).where("google_email", "=", email).executeTakeFirst();
  if (existing) {
    await db.updateTable("gsc_connections").set({ refresh_token: encrypted, scopes: scopes.slice(0, 500), last_error: null, updated_at: ts }).where("id", "=", existing.id).execute();
    tokenCache.delete(existing.id);
    return existing.id;
  }
  const res = await db
    .insertInto("gsc_connections")
    .values({ user_id: userId, google_email: email.slice(0, 190), refresh_token: encrypted, scopes: scopes.slice(0, 500), last_error: null, created_at: ts, updated_at: ts })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

/** Disconnect: revoke at Google (best effort), detach the projects that used it, delete the row. Imported rows are kept. */
export async function deleteConnection(conn: Pick<GscConnectionRecord, "id">): Promise<void> {
  const db = await getDb();
  const row = await db.selectFrom("gsc_connections").select("refresh_token").where("id", "=", conn.id).executeTakeFirst();
  if (row) {
    try {
      await revokeToken(await decryptSecret(row.refresh_token, TOKEN_PURPOSE));
    } catch {
      // Unreadable token (app secret changed): nothing to revoke.
    }
  }
  tokenCache.delete(conn.id);
  await db.updateTable("projects").set({ gsc_connection_id: null, gsc_property: null, updated_at: now() }).where("gsc_connection_id", "=", conn.id).execute();
  await db.deleteFrom("gsc_connections").where("id", "=", conn.id).execute();
}

// ── access tokens ──

const globalForTokens = globalThis as unknown as { __searchzenGscTokens?: Map<number, { token: string; expiresAt: number }> };
const tokenCache = (globalForTokens.__searchzenGscTokens ??= new Map());

/**
 * A valid access token for the connection (cached until a minute before it expires).
 * Throws GoogleApiError; kind "revoked" also marks the connection broken and notifies its owner.
 */
export async function getAccessToken(connectionId: number): Promise<string> {
  const hit = tokenCache.get(connectionId);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const db = await getDb();
  const row = await db.selectFrom("gsc_connections").selectAll().where("id", "=", connectionId).executeTakeFirst();
  if (!row) throw new GoogleApiError("Search Console connection not found.", "config");
  if (row.last_error === REVOKED) throw new GoogleApiError("Google access was revoked. Reconnect the account.", "revoked");
  let refresh: string;
  try {
    refresh = await decryptSecret(row.refresh_token, TOKEN_PURPOSE);
  } catch {
    await markBroken(toConnectionRecord(row));
    throw new GoogleApiError("The stored Google token can't be read (the app secret changed). Reconnect the account.", "revoked");
  }
  try {
    const tokens = await refreshAccessToken(refresh);
    tokenCache.set(connectionId, { token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 });
    if (row.last_error) await db.updateTable("gsc_connections").set({ last_error: null, updated_at: now() }).where("id", "=", row.id).execute();
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof GoogleApiError && error.kind === "revoked") await markBroken(toConnectionRecord(row));
    throw error;
  }
}

/** Forget a cached access token (after a 401 from the API). */
export function dropAccessToken(connectionId: number): void {
  tokenCache.delete(connectionId);
}

/** Properties the connection can read; retries once with a fresh token after a 401. */
export async function listConnectionSites(connectionId: number): Promise<GscSite[]> {
  try {
    return await listSites(await getAccessToken(connectionId));
  } catch (error) {
    if (error instanceof GoogleApiError && error.kind === "auth") {
      dropAccessToken(connectionId);
      return listSites(await getAccessToken(connectionId));
    }
    throw error;
  }
}

/** Mark a connection broken and tell its owner once (email when SMTP is set up, plus a row in each project's alert history). */
export async function markBroken(conn: Pick<GscConnectionRecord, "id" | "userId" | "email" | "lastError">): Promise<void> {
  tokenCache.delete(conn.id);
  if (conn.lastError === REVOKED) return;
  const db = await getDb();
  const res = await db
    .updateTable("gsc_connections")
    .set({ last_error: REVOKED, updated_at: now() })
    .where("id", "=", conn.id)
    .where((eb) => eb.or([eb("last_error", "is", null), eb("last_error", "!=", REVOKED)]))
    .executeTakeFirst();
  if (Number(res.numUpdatedRows ?? 0) === 0) return;
  const projects = await db.selectFrom("projects").select(["id", "name"]).where("gsc_connection_id", "=", conn.id).execute();
  let error: string | null = null;
  try {
    const [settings, user, { t }] = await Promise.all([getSettings(), db.selectFrom("users").select(["email", "name"]).where("id", "=", conn.userId).executeTakeFirst(), emailTranslator()]);
    if (!user) return;
    if (!mailConfigured(settings)) {
      error = "Email is not configured";
    } else {
      const link = absoluteUrl(settings, projects[0] ? `/dashboard/projects/${projects[0].id}/gsc` : "/dashboard");
      await sendMail({
        to: user.email,
        subject: t("gsc.email.revokedSubject", { site: settings.site_name }),
        text: t("gsc.email.revokedBody", { name: user.name, email: conn.email, projects: projects.map((p) => p.name).join(", ") || "–", link, site: settings.site_name }),
      });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Sending failed";
  }
  for (const p of projects) await logAlert({ projectId: p.id, channelId: null, event: "gsc_revoked", ok: error === null, error }).catch(() => undefined);
}
