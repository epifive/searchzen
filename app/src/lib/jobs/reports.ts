import "server-only";
import { logAlert } from "@/lib/channels";
import { getDb, now } from "@/lib/db";
import { mailConfigured } from "@/lib/mail";
import { getProject } from "@/lib/projects";
import { sendReportEmail } from "@/lib/reports/email";
import { markScheduleRun, toScheduleRecord } from "@/lib/reports/schedules";
import { getSettings } from "@/lib/settings";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * reports: scheduled report emails that are due (report_schedules.next_send_at ≤ now) of active
 * projects whose owner is not banned. Weekly schedules report on the last 7 days, monthly ones on 30. Without SMTP the
 * run is logged as failed in the project's alert history and the schedule moves on (no backlog
 * of old reports when email is set up later). Checked every 5 minutes.
 */

const INTERVAL_MS = 5 * 60_000;
const BATCH = 20;
const RESERVE_MS = 3_000;

export const reportsJob: Job = {
  name: "reports",
  async run(ctx) {
    if (!(await isDue("reports", ctx))) return 0;
    const db = await getDb();
    const due = await db
      .selectFrom("report_schedules")
      .innerJoin("projects", "projects.id", "report_schedules.project_id")
      .innerJoin("users", "users.id", "projects.user_id")
      .selectAll("report_schedules")
      .where("report_schedules.is_active", "=", 1)
      .where("report_schedules.next_send_at", "<=", now())
      .where("projects.status", "=", "active")
      .where("users.status", "=", "active")
      .orderBy("report_schedules.next_send_at")
      .limit(BATCH)
      .execute();
    const mailReady = mailConfigured(await getSettings());
    let sent = 0;
    for (const row of due) {
      if (Date.now() > ctx.deadline - RESERVE_MS) break;
      const schedule = toScheduleRecord(row);
      const project = await getProject(schedule.projectId);
      if (!project) continue;
      let error: string | null = null;
      if (!mailReady) error = "Email is not configured";
      else if (!schedule.recipients.length) error = "No recipients";
      else {
        try {
          await sendReportEmail(project, schedule.recipients, schedule.frequency === "monthly" ? 30 : 7);
          sent += 1;
        } catch (e) {
          error = e instanceof Error ? e.message : "Sending failed";
        }
      }
      await markScheduleRun(schedule.id, schedule.frequency, error === null);
      await logAlert({ projectId: project.id, channelId: null, event: "report_sent", ok: error === null, error }).catch(() => undefined);
    }
    await scheduleNext("reports", due.length >= BATCH ? 0 : INTERVAL_MS);
    return sent;
  },
};
