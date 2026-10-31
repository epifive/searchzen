import "server-only";
import type { AuditIssueItem, AuditStatusInfo } from "./audit/service";
import { getDb } from "./db";

/** REST API shapes of site audits (/api/v1/audits) and the ownership check. */

export function toApiAudit(a: AuditStatusInfo) {
  return {
    id: a.id,
    project_id: a.projectId,
    status: a.status,
    trigger: a.trigger,
    pages_crawled: a.pagesCrawled,
    pages_limit: a.pagesLimit,
    queued_urls: a.queued,
    score: a.score,
    summary: { critical: a.summary.critical, warning: a.summary.warning, notice: a.summary.notice, by_code: a.summary.byCode, pages_with_issues: a.summary.pagesWithIssues, pages_with_critical: a.summary.pagesWithCritical },
    change: a.diff ? { previous_audit_id: a.diff.previousAuditId, previous_score: a.diff.previousScore, new_issues: a.diff.newIssues, fixed_issues: a.diff.fixedIssues } : null,
    error: a.error,
    created_at: a.createdAt,
    started_at: a.startedAt,
    finished_at: a.finishedAt,
  };
}

export function toApiIssue(i: AuditIssueItem) {
  return { id: i.id, code: i.code, severity: i.severity, category: i.category, url: i.url, details: i.details, is_new: i.isNew };
}

/** True when the audit belongs to one of the user's projects. */
export async function ownsAudit(auditId: number, userId: number): Promise<boolean> {
  if (!Number.isInteger(auditId) || auditId < 1) return false;
  const db = await getDb();
  const row = await db
    .selectFrom("audits")
    .innerJoin("projects", "projects.id", "audits.project_id")
    .select("audits.id")
    .where("audits.id", "=", auditId)
    .where("projects.user_id", "=", userId)
    .executeTakeFirst();
  return Boolean(row);
}
