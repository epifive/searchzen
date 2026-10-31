import { apiError, apiGuard, apiJson } from "@/lib/api-guard";
import { ownsAudit, toApiIssue } from "@/lib/api-audits";
import { pageParams, pathId } from "@/lib/api-v1";
import { listAuditIssues } from "@/lib/audit/service";
import { SEVERITIES, type Severity } from "@/seo/types";

/** GET /api/v1/audits/{id}/issues[?severity=critical|warning|notice][&code=][&change=new|fixed][&limit=50][&offset=0] */

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const id = pathId((await params).id);
  if (!(await ownsAudit(id, guard.user.id))) return apiError(404, "Audit not found.");
  const url = new URL(request.url);
  const severity = url.searchParams.get("severity");
  if (severity && !(SEVERITIES as readonly string[]).includes(severity)) return apiError(422, `severity must be one of: ${SEVERITIES.join(", ")}.`);
  const change = url.searchParams.get("change") ?? "all";
  if (!["all", "new", "fixed"].includes(change)) return apiError(422, "change must be all, new or fixed.");
  const code = url.searchParams.get("code") ?? undefined;
  if (code !== undefined && !/^[a-z0-9_]{1,60}$/.test(code)) return apiError(422, "code must be an issue code such as title_missing.");
  const { limit, offset } = pageParams(url);
  const { total, issues } = await listAuditIssues(id, { severity: (severity as Severity) || undefined, code, change: change as "all" | "new" | "fixed", limit, offset });
  return apiJson({ data: issues.map(toApiIssue), total, limit, offset });
}
