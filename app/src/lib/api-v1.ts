import "server-only";
import { apiError } from "./api-guard";
import type { KeywordRecord } from "./keywords";
import { getOwnedProject, type ProjectRecord } from "./projects";
import { BodyTooLargeError, isRecord, parseJsonText, readBodyText } from "./public-api";
import type { ApiKeyword, ApiProject } from "@/seo/types";

/**
 * Shared helpers of the REST API (/api/v1, Authorization: Bearer <API key>).
 * Errors are JSON { error } with: 401 missing / invalid key, 403 plan without API access or a
 * plan limit, 404 unknown id (or another account's), 409 conflict (audit already running),
 * 413 body too large, 422 invalid input, 429 rate limit.
 */

export const MAX_API_BODY = 256 * 1024;

/** The JSON object body of a request, or an error response. */
export async function readApiJson(request: Request): Promise<Record<string, unknown> | Response> {
  let text: string;
  try {
    text = await readBodyText(request, MAX_API_BODY);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return apiError(413, "Request body too large (max 256 KB).");
    return apiError(422, "Could not read the request body.");
  }
  const body = parseJsonText(text);
  if (!isRecord(body)) return apiError(422, "Send a JSON object (Content-Type: application/json).");
  return body;
}

/** project_id from a body / query value, checked against the API key's account. */
export async function apiProject(value: unknown, userId: number): Promise<ProjectRecord | Response> {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(id) || id < 1) return apiError(422, "project_id is required (the id of one of your projects).");
  const project = await getOwnedProject(id, userId);
  if (!project) return apiError(404, "Project not found.");
  return project;
}

export function toApiProject(p: ProjectRecord, keywords: number): ApiProject {
  return { id: p.id, name: p.name, domain: p.domain, status: p.status, keywords, created_at: p.createdAt };
}

export function toApiKeyword(k: KeywordRecord): ApiKeyword {
  return {
    id: k.id,
    project_id: k.projectId,
    phrase: k.phrase,
    country: k.country,
    language: k.language,
    device: k.device,
    location: k.location,
    tags: k.tags,
    target_url: k.targetUrl,
    status: k.status,
    position: k.lastPosition,
    best_position: k.bestPosition,
    url: k.lastUrl,
    last_checked_at: k.lastCheckedAt,
  };
}

/** limit / offset query parameters (default 50, max 500). */
export function pageParams(url: URL): { limit: number; offset: number } {
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
  return { limit, offset };
}

/** A positive integer id from a path segment, or NaN. */
export function pathId(value: string): number {
  return /^\d{1,10}$/.test(value) ? Number(value) : NaN;
}

/** Integer query parameter clamped to [min, max] (fallback when missing or invalid). */
export function intQuery(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** 201 Created with a JSON body. */
export function apiCreated(data: unknown, status = 201) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
