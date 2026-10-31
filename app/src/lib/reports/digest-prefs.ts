import "server-only";
import { getDb } from "@/lib/db";
import { writeKey } from "@/lib/jobs/shared";

/**
 * Weekly digest opt-out per account. The base has no notification preferences table, so the
 * choice is a settings row "digest_off:<user id>" = "1" (no row = subscribed).
 */

const key = (userId: number) => `digest_off:${userId}`;

export async function isDigestOptedOut(userId: number): Promise<boolean> {
  const db = await getDb();
  const row = await db.selectFrom("settings").select("value").where("key", "=", key(userId)).executeTakeFirst();
  return row?.value === "1";
}

export async function setDigestOptOut(userId: number, optOut: boolean): Promise<void> {
  if (optOut) {
    await writeKey(key(userId), "1");
    return;
  }
  const db = await getDb();
  await db.deleteFrom("settings").where("key", "=", key(userId)).execute();
}

/** Ids of every account that opted out. */
export async function digestOptOuts(): Promise<Set<number>> {
  const db = await getDb();
  const rows = await db.selectFrom("settings").select(["key", "value"]).where("key", "like", "digest_off:%").execute();
  return new Set(rows.filter((r) => r.value === "1").map((r) => Number(r.key.slice(11))).filter((n) => Number.isInteger(n) && n > 0));
}
