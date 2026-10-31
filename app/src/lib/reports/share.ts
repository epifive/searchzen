import "server-only";
import { sign, verifySignature } from "@/lib/crypto";

/**
 * Password-protected report links. After the right password, the visitor gets a cookie
 * "sz_r_<token>" = "<expires ms>.<HMAC(token, password hash, expires)>" valid for 30 days. The
 * password hash is part of the signed value, so changing or removing the password (or a new
 * share token) invalidates every unlock cookie.
 */

export const UNLOCK_DAYS = 30;
const PURPOSE = "report-unlock";

export const unlockCookieName = (token: string) => `sz_r_${token}`;

export async function unlockCookieValue(token: string, passwordHash: string, nowMs = Date.now()): Promise<string> {
  const expires = nowMs + UNLOCK_DAYS * 86_400_000;
  return `${expires}.${await sign(`${token}|${passwordHash}|${expires}`, PURPOSE)}`;
}

export async function isUnlocked(token: string, passwordHash: string, cookie: string | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!passwordHash) return true;
  if (!cookie) return false;
  const [expires, signature] = cookie.split(".");
  if (!/^\d+$/.test(expires ?? "") || !signature || Number(expires) < nowMs) return false;
  return verifySignature(`${token}|${passwordHash}|${expires}`, signature, PURPOSE);
}
