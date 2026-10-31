"use server";

import { runAuditTick } from "@/lib/audit/crawler";
import { cancelAudit, getAuditStatus, startAudit, type StartAuditError } from "@/lib/audit/service";
import { guardDashboard } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { getOwnedProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import type { AuditStatus } from "@/seo/types";
import type { FormState } from "../types";
import { idOf } from "./helpers";

const START_ERRORS: Record<StartAuditError, MessageKey> = {
  not_found: "audit.err.notFound",
  running: "audit.err.running",
  quota: "audit.err.quota",
  paused: "audit.err.paused",
};

/** Start a site audit of a project (plan quota and page cap apply). */
export async function startAuditAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!rateLimit(`sz-audit-start:${guard.user.id}`, 10, 60 * 60_000)) return { error: t("audit.err.rate") };
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  const result = await startAudit(project.id, "manual");
  if (!result.ok) return { error: t(START_ERRORS[result.error]) };
  return { success: t("audit.started") };
}

/** Cancel the running audit of a project. */
export async function cancelAuditAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  const status = project ? await getAuditStatus(idOf(formData.get("audit_id"))) : null;
  if (!project || !status || status.projectId !== project.id) return { error: t("audit.err.notFound") };
  await cancelAudit(status.id);
  return { success: t("audit.cancelled") };
}

export interface AuditPoll {
  status: AuditStatus;
  pagesCrawled: number;
  pagesLimit: number;
  queued: number;
  score: number | null;
  error: string | null;
}

/**
 * Progress of a running audit for the audit page. While someone watches it, each poll also
 * crawls a slice (a few seconds) of the audit, so audits progress even without a cron job.
 */
export async function pollAuditAction(projectId: number, auditId: number): Promise<AuditPoll | null> {
  const guard = await guardDashboard({ allowInDemo: true });
  if (!guard.ok) return null;
  const project = await getOwnedProject(Number(projectId), guard.user.id);
  let status = project ? await getAuditStatus(Number(auditId)) : null;
  if (!project || !status || status.projectId !== project.id) return null;
  const active = status.status === "queued" || status.status === "crawling" || status.status === "analyzing";
  if (active && rateLimit(`sz-audit-poll:${guard.user.id}`, 40, 60_000)) {
    try {
      await runAuditTick(status.id, { deadline: Date.now() + 6_000 });
    } catch (error) {
      console.error("[searchzen] audit tick from the dashboard failed:", error);
    }
    status = (await getAuditStatus(status.id)) ?? status;
  }
  return { status: status.status, pagesCrawled: status.pagesCrawled, pagesLimit: status.pagesLimit, queued: status.queued, score: status.score, error: status.error };
}
