import "server-only";
import crypto from "node:crypto";
import { getDb, now } from "./db";
import type { User } from "./db/schema";
import { getEntitlements } from "./plans";
import { randomToken } from "./tokens";

export const MAX_API_KEYS = 20;

export interface ApiKeyRecord {
  id: number;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export const hashApiKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

export async function getUserApiKeys(userId: number): Promise<ApiKeyRecord[]> {
  const db = await getDb();
  const rows = await db.selectFrom("api_keys").selectAll().where("user_id", "=", userId).orderBy("id", "desc").execute();
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, lastUsedAt: r.last_used_at, createdAt: r.created_at }));
}

/** Creates a key and returns it in full — the only time it is ever visible. */
export async function createApiKey(userId: number, name: string): Promise<{ id: number; key: string }> {
  const key = `sz_${randomToken(40)}`;
  const db = await getDb();
  const res = await db
    .insertInto("api_keys")
    .values({ user_id: userId, name: name.trim().slice(0, 120), key_hash: hashApiKey(key), prefix: key.slice(0, 10), last_used_at: null, created_at: now() })
    .executeTakeFirstOrThrow();
  return { id: Number(res.insertId), key };
}

export async function deleteApiKey(userId: number, keyId: number): Promise<boolean> {
  const db = await getDb();
  const res = await db.deleteFrom("api_keys").where("id", "=", keyId).where("user_id", "=", userId).executeTakeFirst();
  return Number(res.numDeletedRows) > 0;
}

export type ApiAuth =
  | { ok: true; keyId: number; user: Omit<User, "password_hash"> }
  | { ok: false; status: 401 | 403; error: string };

/** Checks "Authorization: Bearer <key>": known key, active owner, plan with API access. */
export async function authenticateApiRequest(request: Request): Promise<ApiAuth> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S{10,200})$/i.exec(header.trim());
  if (!match) return { ok: false, status: 401, error: "Missing API key. Send it as: Authorization: Bearer <key>" };
  const db = await getDb();
  const key = await db.selectFrom("api_keys").selectAll().where("key_hash", "=", hashApiKey(match[1])).executeTakeFirst();
  if (!key) return { ok: false, status: 401, error: "Invalid API key." };
  const row = await db.selectFrom("users").selectAll().where("id", "=", key.user_id).executeTakeFirst();
  if (!row || row.status !== "active") return { ok: false, status: 403, error: "This account is not active." };
  const { password_hash: _hash, ...user } = row;
  void _hash;
  const entitlements = await getEntitlements(user);
  if (!entitlements.allowApi) return { ok: false, status: 403, error: "Your plan does not include REST API access." };
  // Remember when the key was last used (at most one write per minute).
  if (!key.last_used_at || Date.now() - Date.parse(key.last_used_at) > 60_000) {
    await db.updateTable("api_keys").set({ last_used_at: now() }).where("id", "=", key.id).execute();
  }
  return { ok: true, keyId: key.id, user };
}
