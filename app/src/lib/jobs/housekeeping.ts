import "server-only";
import { cleanupExpiredSessions } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * housekeeping (hourly): expired sessions and password reset links, alert_log rows older than
 * 90 days and SERP snapshots older than 30 days (rankings themselves are kept).
 */

const INTERVAL_MS = 60 * 60_000;
const ALERT_LOG_DAYS = 90;
const SNAPSHOT_DAYS = 30;

export const housekeepingJob: Job = {
  name: "housekeeping",
  async run(ctx) {
    if (!(await isDue("housekeeping", ctx))) return 0;
    const db = await getDb();
    await cleanupExpiredSessions();
    const log = await db
      .deleteFrom("alert_log")
      .where("created_at", "<", new Date(Date.now() - ALERT_LOG_DAYS * 86_400_000).toISOString())
      .executeTakeFirst();
    const snapshots = await db
      .deleteFrom("serp_snapshots")
      .where("checked_at", "<", new Date(Date.now() - SNAPSHOT_DAYS * 86_400_000).toISOString())
      .executeTakeFirst();
    await scheduleNext("housekeeping", INTERVAL_MS);
    return Number(log.numDeletedRows ?? 0) + Number(snapshots.numDeletedRows ?? 0);
  },
};
