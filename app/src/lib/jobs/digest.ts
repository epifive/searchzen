import "server-only";
import { getDb } from "@/lib/db";
import { mailConfigured } from "@/lib/mail";
import { sendDigest } from "@/lib/reports/digest";
import { digestOptOuts } from "@/lib/reports/digest-prefs";
import { getSettings } from "@/lib/settings";
import type { Job } from "./index";
import { isDue, scheduleNext, writeKey } from "./shared";

/**
 * digest: the weekly digest email (src/lib/reports/digest.ts), from Monday 07:00 UTC. Each
 * owner gets it once per week ("digest_week:<user id>" = the Monday of the week it was sent),
 * in batches while the tick has time. Skipped when the admin turned the digest off, without
 * SMTP, and for accounts that opted out. Checked every 30 minutes.
 */

const INTERVAL_MS = 30 * 60_000;
const SEND_HOUR_UTC = 7;
const BATCH = 25;
const RESERVE_MS = 3_000;

/** Monday (UTC) of the week of `ms`, YYYY-MM-DD. */
export function weekKey(ms = Date.now()): string {
  const d = new Date(ms);
  const weekday = d.getUTCDay() || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (weekday - 1))).toISOString().slice(0, 10);
}

/** True from Monday SEND_HOUR_UTC (the whole week after that, so a missed Monday still sends). */
export function digestWindowOpen(ms = Date.now()): boolean {
  const start = Date.parse(`${weekKey(ms)}T00:00:00Z`) + SEND_HOUR_UTC * 3_600_000;
  return ms >= start;
}

export const digestJob: Job = {
  name: "digest",
  async run(ctx) {
    if (!(await isDue("digest", ctx))) return 0;
    const settings = await getSettings();
    if (!settings.digest_enabled || !mailConfigured(settings) || !digestWindowOpen()) {
      await scheduleNext("digest", INTERVAL_MS);
      return 0;
    }
    const week = weekKey();
    const db = await getDb();
    const [owners, sentRows, optOut] = await Promise.all([
      db
        .selectFrom("users")
        .innerJoin("projects", "projects.user_id", "users.id")
        .select(["users.id", "users.name", "users.email"])
        .where("users.status", "=", "active")
        .where("projects.status", "=", "active")
        .distinct()
        .orderBy("users.id")
        .execute(),
      db.selectFrom("settings").select(["key", "value"]).where("key", "like", "digest_week:%").execute(),
      digestOptOuts(),
    ]);
    const done = new Set(sentRows.filter((r) => r.value === week).map((r) => Number(r.key.slice(12))));
    const todo = owners.filter((u) => !done.has(u.id) && !optOut.has(u.id));
    let sent = 0;
    let processed = 0;
    for (const user of todo.slice(0, BATCH)) {
      if (Date.now() > ctx.deadline - RESERVE_MS) break;
      processed += 1;
      try {
        if (await sendDigest(user)) sent += 1;
      } catch (error) {
        console.error(`[searchzen] digest for user ${user.id} failed:`, error instanceof Error ? error.message : error);
      }
      // Marked either way: one attempt per week, no retry storms.
      await writeKey(`digest_week:${user.id}`, week);
    }
    await scheduleNext("digest", processed < todo.length ? 0 : INTERVAL_MS);
    return sent;
  },
};
