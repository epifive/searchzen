import "server-only";
import { sql } from "kysely";
import { getDb } from "./db";
import type { Entitlements } from "./plans";

/**
 * Monthly usage per user (usage_monthly, UTC month): SERP requests and audit pages (informational,
 * shown in the usage meter) and site audits started (the plan's max_audits_monthly quota).
 * Tracked keywords and projects are limits on what exists, not on usage: count them with
 * countUserKeywords() / countUserProjects() in ./keywords.ts and ./projects.ts.
 */

export interface MonthlyUsage {
  serpRequests: number;
  auditPages: number;
  audits: number;
}

export type UsageCounter = keyof MonthlyUsage;

const COLUMN: Record<UsageCounter, "serp_requests" | "audit_pages" | "audits"> = {
  serpRequests: "serp_requests",
  auditPages: "audit_pages",
  audits: "audits",
};

/** "YYYY-MM" of an instant (UTC). */
export function usageMonth(at: Date | number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 7);
}

export async function getUsage(userId: number, month = usageMonth()): Promise<MonthlyUsage> {
  const db = await getDb();
  const row = await db
    .selectFrom("usage_monthly")
    .select(["serp_requests", "audit_pages", "audits"])
    .where("user_id", "=", userId)
    .where("month", "=", month)
    .executeTakeFirst();
  return { serpRequests: Number(row?.serp_requests ?? 0), auditPages: Number(row?.audit_pages ?? 0), audits: Number(row?.audits ?? 0) };
}

/** Add to this month's counters (creates the row on first use). Negative deltas are allowed (corrections). */
export async function incrementUsage(userId: number, delta: Partial<MonthlyUsage>, month = usageMonth()): Promise<void> {
  const entries = (Object.keys(COLUMN) as UsageCounter[]).map((k) => [COLUMN[k], Math.trunc(delta[k] ?? 0)] as const).filter(([, n]) => n !== 0);
  if (!entries.length) return;
  const db = await getDb();
  const set = Object.fromEntries(entries.map(([col, n]) => [col, sql`${sql.ref(col)} + ${n}`]));
  const update = () => db.updateTable("usage_monthly").set(set).where("user_id", "=", userId).where("month", "=", month);
  const updated = await update().executeTakeFirst();
  if (Number(updated.numUpdatedRows) > 0) return;
  const values = { user_id: userId, month, serp_requests: 0, audit_pages: 0, audits: 0 };
  for (const [col, n] of entries) values[col] = Math.max(0, n);
  try {
    await db.insertInto("usage_monthly").values(values).execute();
  } catch {
    // Created by a concurrent request in the meantime.
    await update().execute();
  }
}

/** True when the user may start another site audit this month (0 = unlimited). */
export async function hasAuditQuota(userId: number, entitlements: Pick<Entitlements, "maxAuditsMonthly">): Promise<boolean> {
  if (entitlements.maxAuditsMonthly <= 0) return true;
  return (await getUsage(userId)).audits < entitlements.maxAuditsMonthly;
}
