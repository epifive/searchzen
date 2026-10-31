import { apiGuard, apiJson } from "@/lib/api-guard";
import { toApiProject } from "@/lib/api-v1";
import { countKeywordsByProject } from "@/lib/keywords";
import { getUserProjects } from "@/lib/projects";

/** GET /api/v1/projects: the account's projects with their keyword counts. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const [projects, counts] = await Promise.all([getUserProjects(guard.user.id), countKeywordsByProject(guard.user.id)]);
  return apiJson({ data: projects.map((p) => toApiProject(p, counts.get(p.id) ?? 0)) });
}
