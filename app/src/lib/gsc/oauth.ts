import "server-only";
import crypto from "node:crypto";
import { sign, verifySignature } from "@/lib/crypto";

/**
 * OAuth "state" for the Search Console connect flow. The state is
 * "<user id>.<project id>.<expires ms>.<nonce>.<HMAC>": it is signed with the app secret, bound
 * to the signed-in user, valid for 15 minutes, and its nonce must also be in the
 * STATE_COOKIE (httpOnly, SameSite=Lax) set when the flow started. That double check stops
 * cross-site requests from attaching a Google account to someone else's session.
 */

export const STATE_COOKIE = "sz_gsc_state";
export const STATE_TTL_MS = 15 * 60_000;
const PURPOSE = "gsc-oauth-state";

export interface OAuthState {
  userId: number;
  projectId: number;
  nonce: string;
}

export async function createState(userId: number, projectId: number, nowMs = Date.now()): Promise<{ state: string; nonce: string }> {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const body = `${userId}.${projectId}.${nowMs + STATE_TTL_MS}.${nonce}`;
  return { state: `${body}.${await sign(body, PURPOSE)}`, nonce };
}

/** The state's content when the signature, expiry, user and cookie nonce all match; null otherwise. */
export async function verifyState(state: string, cookieNonce: string | undefined, userId: number, nowMs = Date.now()): Promise<OAuthState | null> {
  const parts = state.split(".");
  if (parts.length !== 5 || !cookieNonce) return null;
  const [user, project, expires, nonce, signature] = parts;
  if (!(await verifySignature(parts.slice(0, 4).join("."), signature, PURPOSE))) return null;
  if (!/^\d+$/.test(user) || !/^\d+$/.test(project) || !/^\d+$/.test(expires)) return null;
  if (Number(expires) < nowMs || Number(user) !== userId) return null;
  const a = Buffer.from(nonce);
  const b = Buffer.from(cookieNonce);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { userId: Number(user), projectId: Number(project), nonce };
}
