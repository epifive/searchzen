import "server-only";
import { getDb, now } from "./db";
import type { Project } from "./db/schema";
import { atLimit, type Entitlements } from "./plans";
import { randomToken } from "./tokens";
import { averagePosition, DEFAULT_PROJECT_SETTINGS, normalizeCountry, normalizeDevice, normalizeDomain, normalizeLanguage, normalizeProjectSettings, parseJson, str, visibilityScore } from "@/seo/normalize";
import type { Device, ProjectSettings, ProjectStatus } from "@/seo/types";

/**
 * Projects (one tracked website each) and their settings. Every function that takes a user id
 * only touches that user's projects; use getOwnedProject() for ids from requests.
 */

export interface ProjectRecord {
  id: number;
  userId: number;
  name: string;
  domain: string;
  settings: ProjectSettings;
  status: ProjectStatus;
  /** Public report token (/r/<token>) or null when sharing is off. */
  shareToken: string | null;
  gscProperty: string | null;
  gscConnectionId: number | null;
  createdAt: string;
  updatedAt: string;
}

export function toProjectRecord(row: Project): ProjectRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    domain: row.domain,
    settings: normalizeProjectSettings(parseJson(row.settings), row.domain),
    status: row.status === "paused" ? "paused" : "active",
    shareToken: row.share_token,
    gscProperty: row.gsc_property,
    gscConnectionId: row.gsc_connection_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserProjects(userId: number): Promise<ProjectRecord[]> {
  const db = await getDb();
  const rows = await db.selectFrom("projects").selectAll().where("user_id", "=", userId).orderBy("name").orderBy("id").execute();
  return rows.map(toProjectRecord);
}

export async function countUserProjects(userId: number): Promise<number> {
  const db = await getDb();
  const row = await db.selectFrom("projects").select((eb) => eb.fn.countAll<number>().as("n")).where("user_id", "=", userId).executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** A project of `userId`, or undefined (also for invalid ids). */
export async function getOwnedProject(projectId: number, userId: number): Promise<ProjectRecord | undefined> {
  if (!Number.isInteger(projectId) || projectId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("projects").selectAll().where("id", "=", projectId).where("user_id", "=", userId).executeTakeFirst();
  return row ? toProjectRecord(row) : undefined;
}

/** Any project by id (jobs, admin). */
export async function getProject(projectId: number): Promise<ProjectRecord | undefined> {
  if (!Number.isInteger(projectId) || projectId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("projects").selectAll().where("id", "=", projectId).executeTakeFirst();
  return row ? toProjectRecord(row) : undefined;
}

/** The project behind a public share token, or undefined (also when its owner is banned). */
export async function getProjectByShareToken(token: string): Promise<ProjectRecord | undefined> {
  if (!/^[A-Za-z0-9]{16,48}$/.test(token)) return undefined;
  const db = await getDb();
  const row = await db
    .selectFrom("projects")
    .innerJoin("users", "users.id", "projects.user_id")
    .selectAll("projects")
    .where("projects.share_token", "=", token)
    .where("users.status", "=", "active")
    .executeTakeFirst();
  return row ? toProjectRecord(row) : undefined;
}

export interface NewProjectInput {
  name: string;
  domain: string;
  country?: string;
  language?: string;
  device?: Device;
}

export type ProjectError = "name" | "domain" | "limit" | "duplicate";

/**
 * Create a project within the plan's project limit. The domain is normalised ("https://www.x.com/"
 * → "x.com"); a user can't add the same domain twice. Returns the new id or an error code.
 */
export async function createProject(
  userId: number,
  entitlements: Pick<Entitlements, "maxProjects" | "checkFrequency">,
  input: NewProjectInput,
): Promise<{ ok: true; id: number } | { ok: false; error: ProjectError }> {
  const name = str(input.name, "", 120);
  const domain = normalizeDomain(input.domain);
  if (!domain) return { ok: false, error: "domain" };
  const db = await getDb();
  if (atLimit(await countUserProjects(userId), entitlements.maxProjects)) return { ok: false, error: "limit" };
  const exists = await db.selectFrom("projects").select("id").where("user_id", "=", userId).where("domain", "=", domain).executeTakeFirst();
  if (exists) return { ok: false, error: "duplicate" };
  const settings: ProjectSettings = {
    ...DEFAULT_PROJECT_SETTINGS,
    country: normalizeCountry(input.country, DEFAULT_PROJECT_SETTINGS.country),
    language: normalizeLanguage(input.language, DEFAULT_PROJECT_SETTINGS.language),
    device: normalizeDevice(input.device, DEFAULT_PROJECT_SETTINGS.device),
    checkFrequency: entitlements.checkFrequency,
  };
  const ts = now();
  const result = await db
    .insertInto("projects")
    .values({
      user_id: userId,
      name: name || domain,
      domain,
      settings: JSON.stringify(settings),
      status: "active",
      share_token: null,
      gsc_property: null,
      gsc_connection_id: null,
      created_at: ts,
      updated_at: ts,
    })
    .executeTakeFirstOrThrow();
  return { ok: true, id: Number(result.insertId) };
}

/** Rename / change the domain / status of a project. Settings are saved with updateProjectSettings(). */
export async function updateProject(
  project: Pick<ProjectRecord, "id" | "userId" | "domain">,
  input: { name?: string; domain?: string; status?: ProjectStatus },
): Promise<{ ok: true } | { ok: false; error: ProjectError }> {
  const db = await getDb();
  const changes: { name?: string; domain?: string; status?: ProjectStatus } = {};
  if (input.name !== undefined) {
    const name = str(input.name, "", 120);
    if (!name) return { ok: false, error: "name" };
    changes.name = name;
  }
  if (input.domain !== undefined) {
    const domain = normalizeDomain(input.domain);
    if (!domain) return { ok: false, error: "domain" };
    if (domain !== project.domain) {
      const exists = await db.selectFrom("projects").select("id").where("user_id", "=", project.userId).where("domain", "=", domain).executeTakeFirst();
      if (exists) return { ok: false, error: "duplicate" };
    }
    changes.domain = domain;
  }
  if (input.status) changes.status = input.status === "paused" ? "paused" : "active";
  if (Object.keys(changes).length) await db.updateTable("projects").set({ ...changes, updated_at: now() }).where("id", "=", project.id).execute();
  return { ok: true };
}

/** Save settings (validated; competitors equal to the project's domain are dropped). */
export async function updateProjectSettings(project: Pick<ProjectRecord, "id" | "domain">, settings: unknown): Promise<ProjectSettings> {
  const clean = normalizeProjectSettings(settings, project.domain);
  const db = await getDb();
  await db.updateTable("projects").set({ settings: JSON.stringify(clean), updated_at: now() }).where("id", "=", project.id).execute();
  return clean;
}

/** Turn the public report link on (new token each time) or off (null). Returns the token. */
export async function setShareToken(projectId: number, enabled: boolean): Promise<string | null> {
  const token = enabled ? randomToken(24) : null;
  const db = await getDb();
  await db.updateTable("projects").set({ share_token: token, updated_at: now() }).where("id", "=", projectId).execute();
  return token;
}

/** Delete a project and everything recorded for it. */
export async function deleteProject(projectId: number): Promise<void> {
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    const keywordIds = (await trx.selectFrom("keywords").select("id").where("project_id", "=", projectId).execute()).map((r) => r.id);
    for (let i = 0; i < keywordIds.length; i += 500) {
      const part = keywordIds.slice(i, i + 500);
      await trx.deleteFrom("serp_snapshots").where("keyword_id", "in", part).execute();
    }
    await trx.deleteFrom("rankings").where("project_id", "=", projectId).execute();
    await trx.deleteFrom("keywords").where("project_id", "=", projectId).execute();
    const auditIds = (await trx.selectFrom("audits").select("id").where("project_id", "=", projectId).execute()).map((r) => r.id);
    for (let i = 0; i < auditIds.length; i += 500) {
      const part = auditIds.slice(i, i + 500);
      await trx.deleteFrom("audit_issues").where("audit_id", "in", part).execute();
      await trx.deleteFrom("audit_pages").where("audit_id", "in", part).execute();
      await trx.deleteFrom("audit_queue").where("audit_id", "in", part).execute();
    }
    await trx.deleteFrom("audits").where("project_id", "=", projectId).execute();
    await trx.deleteFrom("gsc_daily").where("project_id", "=", projectId).execute();
    await trx.deleteFrom("report_schedules").where("project_id", "=", projectId).execute();
    await trx.updateTable("alert_log").set({ project_id: null }).where("project_id", "=", projectId).execute();
    await trx.deleteFrom("projects").where("id", "=", projectId).execute();
  });
}

export interface ProjectSummary {
  keywords: number;
  /** Active keywords ranked within the checked depth at their last check. */
  ranked: number;
  top3: number;
  top10: number;
  averagePosition: number | null;
  /** visibilityScore() of the active keywords' last positions. */
  visibility: number;
  lastAudit: { id: number; status: string; score: number | null; finishedAt: string | null } | null;
}

/** Headline numbers per project for the projects grid (from the keywords' latest positions and the latest audit). */
export async function getProjectSummaries(projectIds: number[]): Promise<Map<number, ProjectSummary>> {
  const out = new Map<number, ProjectSummary>();
  if (!projectIds.length) return out;
  const db = await getDb();
  const keywordRows = await db
    .selectFrom("keywords")
    .select(["project_id", "status", "last_position"])
    .where("project_id", "in", projectIds)
    .execute();
  const positions = new Map<number, Array<number | null>>();
  const counts = new Map<number, number>();
  for (const r of keywordRows) {
    counts.set(r.project_id, (counts.get(r.project_id) ?? 0) + 1);
    if (r.status !== "active") continue;
    const list = positions.get(r.project_id) ?? [];
    list.push(r.last_position === null ? null : Number(r.last_position));
    positions.set(r.project_id, list);
  }
  const audits = await db
    .selectFrom("audits")
    .select(["id", "project_id", "status", "score", "finished_at"])
    .where("project_id", "in", projectIds)
    .orderBy("id", "desc")
    .execute();
  const lastAudit = new Map<number, ProjectSummary["lastAudit"]>();
  for (const a of audits) {
    if (!lastAudit.has(a.project_id)) lastAudit.set(a.project_id, { id: a.id, status: a.status, score: a.score === null ? null : Number(a.score), finishedAt: a.finished_at });
  }
  for (const id of projectIds) {
    const list = positions.get(id) ?? [];
    const ranked = list.filter((p): p is number => p !== null);
    out.set(id, {
      keywords: counts.get(id) ?? 0,
      ranked: ranked.length,
      top3: ranked.filter((p) => p <= 3).length,
      top10: ranked.filter((p) => p <= 10).length,
      averagePosition: averagePosition(list),
      visibility: visibilityScore(list),
      lastAudit: lastAudit.get(id) ?? null,
    });
  }
  return out;
}
