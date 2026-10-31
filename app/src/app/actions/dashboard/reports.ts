"use server";

import { guardDashboard } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { mailConfigured } from "@/lib/mail";
import { getOwnedProject, setShareToken } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { sendReportEmail } from "@/lib/reports/email";
import { createSchedule, deleteSchedule, getProjectSchedule, listSchedules, MAX_RECIPIENTS, MAX_SCHEDULES, updateSchedule } from "@/lib/reports/schedules";
import { getSettings } from "@/lib/settings";
import { normalizeEmail } from "@/seo/normalize";
import type { FormState } from "../types";
import { idOf, str } from "./helpers";

/** Recipients from a textarea: every entry must be an email address, at most MAX_RECIPIENTS. */
function parseRecipients(v: FormDataEntryValue | null): { list: string[]; invalid: string | null } {
  const raw = str(v)
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const invalid = raw.find((e) => !normalizeEmail(e)) ?? null;
  return { list: [...new Set(raw.map(normalizeEmail).filter(Boolean))], invalid };
}

/** New scheduled report email. Turns the share link on, so the email can link to the full report. */
export async function addScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  const frequency = str(formData.get("frequency")) === "monthly" ? "monthly" : "weekly";
  const { list, invalid } = parseRecipients(formData.get("recipients"));
  if (invalid) return { error: t("rep.sched.err.email", { value: invalid }) };
  if (!list.length) return { error: t("rep.sched.err.none") };
  if (list.length > MAX_RECIPIENTS) return { error: t("rep.sched.err.max", { n: MAX_RECIPIENTS }) };
  if ((await listSchedules(project.id)).length >= MAX_SCHEDULES) return { error: t("rep.sched.err.count", { n: MAX_SCHEDULES }) };
  await createSchedule(project.id, frequency, list);
  if (!project.shareToken) await setShareToken(project.id, true);
  return { success: t("rep.sched.added") };
}

export async function toggleScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  const schedule = project ? await getProjectSchedule(project.id, idOf(formData.get("schedule_id"))) : undefined;
  if (!schedule) return { error: t("rep.sched.err.notFound") };
  await updateSchedule(schedule.id, { isActive: !schedule.isActive });
  return { success: t(schedule.isActive ? "rep.sched.paused" : "rep.sched.resumed") };
}

export async function deleteScheduleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  const schedule = project ? await getProjectSchedule(project.id, idOf(formData.get("schedule_id"))) : undefined;
  if (!schedule) return { error: t("rep.sched.err.notFound") };
  await deleteSchedule(schedule.id);
  return { success: t("rep.sched.deleted") };
}

/** Send the report now: to a schedule's recipients, or as a test to the signed-in user. */
export async function sendReportNowAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  if (!mailConfigured(await getSettings())) return { error: t("rep.sched.err.mail") };
  if (!rateLimit(`report-send:${guard.user.id}`, 5, 10 * 60_000)) return { error: t("rep.sched.err.rate") };
  let recipients = [guard.user.email];
  let days: 7 | 30 = 7;
  if (str(formData.get("schedule_id"))) {
    const schedule = await getProjectSchedule(project.id, idOf(formData.get("schedule_id")));
    if (!schedule) return { error: t("rep.sched.err.notFound") };
    recipients = schedule.recipients;
    days = schedule.frequency === "monthly" ? 30 : 7;
  }
  try {
    await sendReportEmail(project, recipients, days);
  } catch (error) {
    return { error: t("rep.sched.err.send", { error: error instanceof Error ? error.message : "?" }) };
  }
  return { success: t("rep.sched.sent", { to: recipients.join(", ") }) };
}
