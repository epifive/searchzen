import "server-only";
import { notFound } from "next/navigation";
import { auditQuery } from "@/components/dashboard/audit-kit";
import { getAuditStatus, listAudits, type AuditStatusInfo } from "@/lib/audit/service";
import { requireProject } from "@/lib/dashboard";

const ACTIVE = new Set(["queued", "crawling", "analyzing"]);

export const isActiveAudit = (a: Pick<AuditStatusInfo, "status">) => ACTIVE.has(a.status);

/**
 * Shared loader of the audit pages: the project, its recent audits, the running one and the
 * audit being looked at (?audit=<id>, default the latest finished one). 404 for audits of
 * other projects.
 */
export async function loadAuditContext(id: string, auditParam: string | string[] | undefined) {
  const { user, project } = await requireProject(id);
  const audits = await listAudits(project.id, 30);
  const running = audits.find(isActiveAudit) ?? null;
  const defaultAudit = audits.find((a) => a.status === "done") ?? audits.find((a) => !isActiveAudit(a)) ?? null;
  const wanted = Number(Array.isArray(auditParam) ? auditParam[0] : auditParam);
  let selected: AuditStatusInfo | null = null;
  if (Number.isInteger(wanted) && wanted > 0) {
    selected = await getAuditStatus(wanted);
    if (!selected || selected.projectId !== project.id) notFound();
  } else if (defaultAudit) {
    selected = await getAuditStatus(defaultAudit.id);
  }
  // A running audit is shown by the progress panel, not as "the selected audit".
  if (selected && isActiveAudit(selected)) selected = defaultAudit && defaultAudit.id !== selected.id ? await getAuditStatus(defaultAudit.id) : null;
  return { user, project, audits, running, selected, defaultId: defaultAudit?.id ?? null, query: auditQuery(selected?.id, defaultAudit?.id) };
}
