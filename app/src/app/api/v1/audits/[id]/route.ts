import { apiError, apiGuard, apiJson } from "@/lib/api-guard";
import { ownsAudit, toApiAudit } from "@/lib/api-audits";
import { pathId } from "@/lib/api-v1";
import { getAuditStatus } from "@/lib/audit/service";

/** GET /api/v1/audits/{id}: status, progress, score and issue summary. */

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const id = pathId((await params).id);
  if (!(await ownsAudit(id, guard.user.id))) return apiError(404, "Audit not found.");
  const status = await getAuditStatus(id);
  if (!status) return apiError(404, "Audit not found.");
  return apiJson({ data: toApiAudit(status) });
}
