import { apiError, apiGuard, apiJson } from "@/lib/api-guard";
import { apiCreated, apiProject, pageParams, readApiJson, toApiKeyword } from "@/lib/api-v1";
import { addKeywords, getProjectKeywordsByIds, listProjectKeywords } from "@/lib/keywords";
import { getEntitlements } from "@/lib/plans";
import { isRecord } from "@/lib/public-api";
import { normalizeDevice, str } from "@/seo/normalize";
import type { KeywordInput } from "@/seo/types";

/**
 * GET  /api/v1/keywords?project_id=1[&status=active|paused][&tag=][&search=][&sort=phrase|position|best|created][&limit=50][&offset=0]
 * POST /api/v1/keywords { project_id, keywords: ["phrase", { phrase, country, language, device, location, tags, target_url }],
 *                         country?, language?, device?, location?, tags? }  (up to 1,000 per request)
 */

export const dynamic = "force-dynamic";

const MAX_PER_REQUEST = 1000;
const SORTS = ["phrase", "position", "best", "created"] as const;

export async function GET(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const project = await apiProject(url.searchParams.get("project_id"), guard.user.id);
  if (project instanceof Response) return project;
  const status = url.searchParams.get("status");
  if (status && status !== "active" && status !== "paused") return apiError(422, "status must be active or paused.");
  const sort = url.searchParams.get("sort") ?? "phrase";
  if (!(SORTS as readonly string[]).includes(sort)) return apiError(422, `sort must be one of: ${SORTS.join(", ")}.`);
  const { limit, offset } = pageParams(url);
  const { total, keywords } = await listProjectKeywords(project.id, {
    status: status === "active" || status === "paused" ? status : undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    sort: sort as (typeof SORTS)[number],
    limit,
    offset,
  });
  return apiJson({ data: keywords.map(toApiKeyword), total, limit, offset });
}

export async function POST(request: Request) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const project = await apiProject(body.project_id, guard.user.id);
  if (project instanceof Response) return project;
  if (!Array.isArray(body.keywords) || !body.keywords.length) return apiError(422, "keywords must be a non-empty array of phrases or keyword objects.");
  if (body.keywords.length > MAX_PER_REQUEST) return apiError(422, `Send at most ${MAX_PER_REQUEST} keywords per request.`);
  const defaults: Partial<KeywordInput> = {
    country: typeof body.country === "string" ? body.country : undefined,
    language: typeof body.language === "string" ? body.language : undefined,
    device: body.device === undefined ? undefined : normalizeDevice(body.device),
    location: typeof body.location === "string" ? body.location : undefined,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : typeof body.tags === "string" ? [body.tags] : undefined,
  };
  if (body.device !== undefined && body.device !== "desktop" && body.device !== "mobile") return apiError(422, "device must be desktop or mobile.");
  const inputs: KeywordInput[] = [];
  for (const item of body.keywords) {
    if (typeof item === "string") inputs.push({ ...defaults, phrase: item });
    else if (isRecord(item)) {
      if (item.device !== undefined && item.device !== "desktop" && item.device !== "mobile") return apiError(422, "device must be desktop or mobile.");
      inputs.push({
        ...defaults,
        phrase: str(item.phrase, "", 1000),
        ...(typeof item.country === "string" ? { country: item.country } : {}),
        ...(typeof item.language === "string" ? { language: item.language } : {}),
        ...(item.device !== undefined ? { device: normalizeDevice(item.device) } : {}),
        ...(typeof item.location === "string" ? { location: item.location } : {}),
        ...(Array.isArray(item.tags) ? { tags: item.tags.map(String) } : {}),
        ...(typeof item.target_url === "string" ? { targetUrl: item.target_url } : {}),
      });
    } else return apiError(422, "Each keyword must be a string or an object with a phrase.");
  }
  const entitlements = await getEntitlements(guard.user);
  const result = await addKeywords(project, entitlements, inputs);
  if (!result.added && result.overLimit) {
    return apiError(403, `Your plan's keyword limit (${entitlements.maxKeywords}) is reached. Upgrade or delete keywords first.`);
  }
  if (!result.added && !result.duplicates) return apiError(422, "No valid keywords in the request.");
  const keywords = await getProjectKeywordsByIds(project.id, result.ids);
  return apiCreated(
    {
      added: result.added,
      duplicates: result.duplicates,
      invalid: result.invalid,
      over_limit: result.overLimit,
      data: keywords.map(toApiKeyword),
    },
    result.added ? 201 : 200,
  );
}
