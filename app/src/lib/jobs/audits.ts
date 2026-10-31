import "server-only";
import { activeAuditIds, runAuditTick } from "@/lib/audit/crawler";
import { startAudit } from "@/lib/audit/service";
import { getDb } from "@/lib/db";
import { normalizeProjectSettings, parseJson } from "@/seo/normalize";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * audits (every tick): starts scheduled audits (active projects of active owners with a weekly /
 * monthly audit schedule, checked every 15 minutes), then crawls and analyses running audits within the
 * tick's time budget, oldest first. Each audit gets at most 20 s per tick so several audits
 * share the budget. Returns the number of pages crawled.
 */

const SCHEDULE_CHECK_MS = 15 * 60_000;
const PER_AUDIT_MS = 20_000;
const DAY_MS = 86_400_000;

/** Start the audits that projects' schedules call for (the plan's monthly audit quota still applies). */
export async function startScheduledAudits(): Promise<number> {
  const db = await getDb();
  const projects = await db
    .selectFrom("projects")
    .innerJoin("users", "users.id", "projects.user_id")
    .select(["projects.id", "projects.domain", "projects.settings"])
    .where("projects.status", "=", "active")
    .where("users.status", "=", "active")
    .execute();
  let started = 0;
  for (const p of projects) {
    const settings = normalizeProjectSettings(parseJson(p.settings), p.domain);
    if (settings.auditSchedule === "off") continue;
    const intervalMs = (settings.auditSchedule === "weekly" ? 7 : 30) * DAY_MS;
    const last = await db.selectFrom("audits").select("created_at").where("project_id", "=", p.id).orderBy("id", "desc").executeTakeFirst();
    // A little slack so a weekly audit doesn't drift later every week.
    if (last && Date.parse(last.created_at) > Date.now() - intervalMs + 30 * 60_000) continue;
    const result = await startAudit(p.id, "schedule");
    if (result.ok) started++;
  }
  return started;
}

export const auditsJob: Job = {
  name: "audits",
  async run(ctx) {
    if (await isDue("audit-schedule", ctx)) {
      await scheduleNext("audit-schedule", SCHEDULE_CHECK_MS);
      await startScheduledAudits().catch((error) => console.error("[searchzen] scheduled audits failed:", error));
    }
    let pages = 0;
    const seen = new Set<number>();
    while (Date.now() < ctx.deadline - 500) {
      const ids = (await activeAuditIds(5)).filter((id) => !seen.has(id));
      if (!ids.length) break;
      for (const id of ids) {
        if (Date.now() >= ctx.deadline - 500) break;
        seen.add(id);
        const result = await runAuditTick(id, { deadline: Math.min(ctx.deadline, Date.now() + PER_AUDIT_MS) });
        pages += result?.pages ?? 0;
      }
    }
    return pages;
  },
};
