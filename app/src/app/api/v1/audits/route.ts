import { apiError, apiGuard } from "@/lib/api-guard";
import { apiCreated, apiProject, readApiJson } from "@/lib/api-v1";
import { toApiAudit } from "@/lib/api-audits";
import { getAuditStatus, startAudit } from "@/lib/audit/service";
import { rateLimit } from "@/lib/rate-limit";

/** POST /api/v1/audits { project_id }: queue a site audit (202). 409 while one runs, 403 when the monthly quota is used. */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const project = await apiProject(body.project_id, guard.user.id);
  if (project instanceof Response) return project;
  if (!rateLimit(`api-audit:${guard.user.id}`, 10, 60 * 60_000)) return apiError(429, "Too many audits started. Try again later.", { "Retry-After": "600" });
  const result = await startAudit(project.id, "api");
  if (!result.ok) {
    if (result.error === "running") return Response.json({ error: "An audit of this project is already running.", audit_id: result.auditId ?? null }, { status: 409, headers: { "Cache-Control": "no-store" } });
    if (result.error === "quota") return apiError(403, "Your plan's monthly site audit quota is used up.");
    if (result.error === "paused") return apiError(409, "The project is paused.");
    return apiError(404, "Project not found.");
  }
  const status = await getAuditStatus(result.auditId);
  return apiCreated({ data: status ? toApiAudit(status) : { id: result.auditId, status: "queued" } }, 202);
}
