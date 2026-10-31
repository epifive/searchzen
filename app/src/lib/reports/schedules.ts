import "server-only";
import { getDb, now } from "@/lib/db";
import { normalizeEmailList } from "@/seo/normalize";
import type { ReportFrequency } from "@/seo/types";

/**
 * Scheduled report emails (report_schedules): weekly (Mondays) or monthly (the 1st), sent at
 * SEND_HOUR_UTC by the "reports" job to up to MAX_RECIPIENTS addresses.
 */

export const MAX_RECIPIENTS = 10;
export const MAX_SCHEDULES = 5;
export const SEND_HOUR_UTC = 7;

export interface ScheduleRecord {
  id: number;
  projectId: number;
  frequency: ReportFrequency;
  recipients: string[];
  isActive: boolean;
  lastSentAt: string | null;
  nextSendAt: string;
}

/** The next send time strictly after `from`: next Monday (weekly) or the next 1st of a month (monthly), 07:00 UTC. */
export function nextSendAt(frequency: ReportFrequency, from: number = Date.now()): string {
  const d = new Date(from);
  if (frequency === "monthly") {
    let candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, SEND_HOUR_UTC);
    if (candidate <= from) candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, SEND_HOUR_UTC);
    return new Date(candidate).toISOString();
  }
  const weekday = d.getUTCDay() || 7; // 1 = Monday
  let candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (weekday - 1), SEND_HOUR_UTC);
  while (candidate <= from) candidate += 7 * 86_400_000;
  return new Date(candidate).toISOString();
}

type Row = { id: number; project_id: number; frequency: string; recipients: string; is_active: number; last_sent_at: string | null; next_send_at: string };

export function toScheduleRecord(r: Row): ScheduleRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    frequency: r.frequency === "monthly" ? "monthly" : "weekly",
    recipients: normalizeEmailList(r.recipients, MAX_RECIPIENTS),
    isActive: r.is_active === 1,
    lastSentAt: r.last_sent_at,
    nextSendAt: r.next_send_at,
  };
}

export async function listSchedules(projectId: number): Promise<ScheduleRecord[]> {
  const db = await getDb();
  const rows = await db.selectFrom("report_schedules").selectAll().where("project_id", "=", projectId).orderBy("id").execute();
  return rows.map(toScheduleRecord);
}

export async function getProjectSchedule(projectId: number, id: number): Promise<ScheduleRecord | undefined> {
  if (!Number.isInteger(id) || id < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("report_schedules").selectAll().where("id", "=", id).where("project_id", "=", projectId).executeTakeFirst();
  return row ? toScheduleRecord(row) : undefined;
}

export async function createSchedule(projectId: number, frequency: ReportFrequency, recipients: string[]): Promise<number> {
  const db = await getDb();
  const ts = now();
  const res = await db
    .insertInto("report_schedules")
    .values({ project_id: projectId, frequency, recipients: recipients.slice(0, MAX_RECIPIENTS).join(", "), is_active: 1, last_sent_at: null, next_send_at: nextSendAt(frequency), created_at: ts, updated_at: ts })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

export async function updateSchedule(id: number, input: { frequency?: ReportFrequency; recipients?: string[]; isActive?: boolean }): Promise<void> {
  const db = await getDb();
  const set: { frequency?: ReportFrequency; recipients?: string; is_active?: number; next_send_at?: string; updated_at: string } = { updated_at: now() };
  if (input.frequency) {
    set.frequency = input.frequency;
    set.next_send_at = nextSendAt(input.frequency);
  }
  if (input.recipients) set.recipients = input.recipients.slice(0, MAX_RECIPIENTS).join(", ");
  if (input.isActive !== undefined) set.is_active = input.isActive ? 1 : 0;
  await db.updateTable("report_schedules").set(set).where("id", "=", id).execute();
}

export async function deleteSchedule(id: number): Promise<void> {
  const db = await getDb();
  await db.deleteFrom("report_schedules").where("id", "=", id).execute();
}

/** After a run (sent or not): remember it and move to the next slot. */
export async function markScheduleRun(id: number, frequency: ReportFrequency, sent: boolean): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db
    .updateTable("report_schedules")
    .set({ ...(sent ? { last_sent_at: ts } : {}), next_send_at: nextSendAt(frequency), updated_at: ts })
    .where("id", "=", id)
    .execute();
}
