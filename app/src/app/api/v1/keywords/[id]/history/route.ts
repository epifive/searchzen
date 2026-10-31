import { apiError, apiGuard, apiJson } from "@/lib/api-guard";
import { intQuery, pathId, toApiKeyword } from "@/lib/api-v1";
import { getDb } from "@/lib/db";
import { toKeywordRecord } from "@/lib/keywords";
import { getKeywordHistory } from "@/lib/rank/service";

/** GET /api/v1/keywords/{id}/history?days=30 (1–400): daily positions, oldest first. */

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const id = pathId((await params).id);
  if (!Number.isInteger(id)) return apiError(404, "Keyword not found.");
  const url = new URL(request.url);
  const raw = url.searchParams.get("days");
  if (raw !== null && !/^\d{1,3}$/.test(raw)) return apiError(422, "days must be a whole number from 1 to 400.");
  const days = intQuery(url, "days", 30, 1, 400);
  const db = await getDb();
  const row = await db
    .selectFrom("keywords")
    .innerJoin("projects", "projects.id", "keywords.project_id")
    .selectAll("keywords")
    .where("keywords.id", "=", id)
    .where("projects.user_id", "=", guard.user.id)
    .executeTakeFirst();
  if (!row) return apiError(404, "Keyword not found.");
  const history = await getKeywordHistory(id, days);
  return apiJson({
    data: {
      keyword: toApiKeyword(toKeywordRecord(row)),
      days,
      history: history.map((h) => ({ day: h.day, position: h.position, url: h.url, features: h.features, competitors: h.competitors, checked_at: h.checkedAt })),
    },
  });
}
