import { apiError, apiGuard, apiJson } from "@/lib/api-guard";
import { apiProject, readApiJson } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";
import { checkKeywordsNow, CHECK_NOW_BURST, CHECK_NOW_MAX, takeManualChecks } from "@/lib/rank/service";

/**
 * POST /api/v1/keywords/check { keyword_ids: [1, 2] } or { project_id: 1 } (its active keywords,
 * up to 100): checks positions right away with the platform's SERP provider. Keywords checked in
 * the last 10 minutes are skipped. Limits per account, shared with the dashboard's "Check now":
 * CHECK_NOW_BURST requests per 10 minutes and a daily cap of manual checks (the plan's keyword
 * limit, at least 25; 500 when unlimited).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  if (!rateLimit(`api-check:${guard.user.id}`, 10, 60_000)) return apiError(429, "Too many check requests. Try again in a minute.", { "Retry-After": "60" });
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  let ids: number[] = [];
  if (body.keyword_ids !== undefined) {
    if (!Array.isArray(body.keyword_ids) || !body.keyword_ids.length) return apiError(422, "keyword_ids must be a non-empty array of keyword ids.");
    ids = body.keyword_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length !== body.keyword_ids.length) return apiError(422, "keyword_ids must contain keyword ids (positive integers).");
    if (ids.length > CHECK_NOW_MAX) return apiError(422, `Check at most ${CHECK_NOW_MAX} keywords per request.`);
    const db = await getDb();
    const owned = await db
      .selectFrom("keywords")
      .innerJoin("projects", "projects.id", "keywords.project_id")
      .select("keywords.id")
      .where("keywords.id", "in", ids)
      .where("projects.user_id", "=", guard.user.id)
      .execute();
    if (owned.length !== new Set(ids).size) return apiError(404, "One or more keywords were not found.");
  } else {
    if (body.project_id === undefined) return apiError(422, "Send keyword_ids or project_id.");
    const project = await apiProject(body.project_id, guard.user.id);
    if (project instanceof Response) return project;
    const db = await getDb();
    ids = (await db.selectFrom("keywords").select("id").where("project_id", "=", project.id).where("status", "=", "active").orderBy("id").limit(CHECK_NOW_MAX).execute()).map((r) => r.id);
    if (!ids.length) return apiError(422, "The project has no active keywords.");
  }
  const allowed = takeManualChecks(guard.user.id, await getEntitlements(guard.user), ids.length);
  if (!allowed.ok) {
    if (allowed.reason === "rate") return apiError(429, `Too many check requests: at most ${CHECK_NOW_BURST} per 10 minutes. Try again later.`, { "Retry-After": "600" });
    return apiError(429, `Today's limit of ${allowed.cap} manual checks is reached. Scheduled checks continue as usual.`, { "Retry-After": "3600" });
  }
  const result = await checkKeywordsNow(ids, { userId: guard.user.id, budgetMs: 40_000 });
  if (result.error === "no_provider") return apiError(409, "Rank checks are not set up on this platform (no SERP provider).");
  if (result.error === "paused") return apiError(409, "Rank checks are paused after a provider error. Try again later.");
  return apiJson({ checked: result.checked, failed: result.failed, skipped: result.skipped, skipped_ids: result.skippedIds, alerts: result.alerts });
}
