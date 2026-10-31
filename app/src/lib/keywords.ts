import "server-only";
import { checkQuotaAlerts } from "./alerts/quota";
import { getDb, now } from "./db";
import type { Keyword } from "./db/schema";
import { remaining, type Entitlements } from "./plans";
import type { ProjectRecord } from "./projects";
import { sha256 } from "./tokens";
import {
  keywordIdentity,
  normalizeCountry,
  normalizeDevice,
  normalizeFeatures,
  normalizeKeyword,
  normalizeLanguage,
  normalizeTags,
  normalizeTargetUrl,
  parseJsonList,
  str,
} from "@/seo/normalize";
import type { Device, KeywordInput, KeywordStatus, SerpFeature } from "@/seo/types";

/**
 * Tracked keywords of a project: adding (one or many, de-duplicated, within the plan's keyword
 * limit), listing with their latest positions, pausing and deleting. The rank job
 * (src/lib/serp) updates the position columns; this module never checks rankings itself.
 *
 * The plan's keyword limit counts every keyword of the account (active and paused).
 */

export interface KeywordRecord {
  id: number;
  projectId: number;
  phrase: string;
  country: string;
  language: string;
  device: Device;
  location: string;
  tags: string[];
  targetUrl: string | null;
  status: KeywordStatus;
  lastCheckedAt: string | null;
  lastPosition: number | null;
  bestPosition: number | null;
  startPosition: number | null;
  lastUrl: string | null;
  lastFeatures: SerpFeature[];
  nextCheckAt: string;
  failCount: number;
  lastError: string | null;
  createdAt: string;
}

const num = (v: number | null) => (v === null || v === undefined ? null : Number(v));

export function toKeywordRecord(row: Keyword): KeywordRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    phrase: row.phrase,
    country: row.country,
    language: row.language,
    device: row.device === "mobile" ? "mobile" : "desktop",
    location: row.location,
    tags: parseJsonList(row.tags),
    targetUrl: row.target_url,
    status: row.status === "paused" ? "paused" : "active",
    lastCheckedAt: row.last_checked_at,
    lastPosition: num(row.last_position),
    bestPosition: num(row.best_position),
    startPosition: num(row.start_position),
    lastUrl: row.last_url,
    lastFeatures: normalizeFeatures(parseJsonList(row.last_features)),
    nextCheckAt: row.next_check_at,
    failCount: Number(row.fail_count ?? 0),
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

/** sha256 of the keyword's identity (keywords.dedupe_key, unique per project). */
export function keywordDedupeKey(k: { phrase: string; country: string; language: string; device: Device; location: string }): string {
  return sha256(keywordIdentity(k));
}

export async function countUserKeywords(userId: number): Promise<number> {
  const db = await getDb();
  const row = await db
    .selectFrom("keywords")
    .innerJoin("projects", "projects.id", "keywords.project_id")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("projects.user_id", "=", userId)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Keyword counts per project of a user (projects without keywords are missing). */
export async function countKeywordsByProject(userId: number): Promise<Map<number, number>> {
  const db = await getDb();
  const rows = await db
    .selectFrom("keywords")
    .innerJoin("projects", "projects.id", "keywords.project_id")
    .select(["keywords.project_id", (eb) => eb.fn.countAll<number>().as("n")])
    .where("projects.user_id", "=", userId)
    .groupBy("keywords.project_id")
    .execute();
  return new Map(rows.map((r) => [r.project_id, Number(r.n ?? 0)]));
}

export interface AddKeywordsResult {
  /** Ids of the inserted keywords, in input order. */
  ids: number[];
  added: number;
  /** Already tracked in the project, or repeated in the input. */
  duplicates: number;
  /** Empty after normalisation. */
  invalid: number;
  /** Left out because the plan's keyword limit was reached. */
  overLimit: number;
}

/**
 * Add keywords to a project. Unset fields use the project's defaults (country, language,
 * device, location). Input order is kept; duplicates (same phrase, country, language, device and
 * location) are skipped; keywords beyond the plan's limit are not added. New keywords are due
 * for a check right away (next_check_at = now).
 */
export async function addKeywords(
  project: Pick<ProjectRecord, "id" | "userId" | "domain" | "settings">,
  entitlements: Pick<Entitlements, "maxKeywords">,
  inputs: KeywordInput[],
): Promise<AddKeywordsResult> {
  const result: AddKeywordsResult = { ids: [], added: 0, duplicates: 0, invalid: 0, overLimit: 0 };
  const d = project.settings;
  const seen = new Set<string>();
  const candidates: Array<{ key: string; phrase: string; country: string; language: string; device: Device; location: string; tags: string[]; targetUrl: string | null }> = [];
  for (const input of inputs) {
    const phrase = normalizeKeyword(input.phrase);
    if (!phrase) {
      result.invalid += 1;
      continue;
    }
    const k = {
      phrase,
      country: normalizeCountry(input.country, d.country),
      language: normalizeLanguage(input.language, d.language),
      device: normalizeDevice(input.device, d.device),
      location: str(input.location ?? d.location, "", 120),
    };
    const key = keywordDedupeKey(k);
    if (seen.has(key)) {
      result.duplicates += 1;
      continue;
    }
    seen.add(key);
    candidates.push({ ...k, key, tags: normalizeTags(input.tags ?? []), targetUrl: normalizeTargetUrl(input.targetUrl, project.domain) });
  }
  if (!candidates.length) return result;

  const db = await getDb();
  const existing = new Set<string>();
  for (let i = 0; i < candidates.length; i += 500) {
    const part = candidates.slice(i, i + 500).map((c) => c.key);
    const rows = await db.selectFrom("keywords").select("dedupe_key").where("project_id", "=", project.id).where("dedupe_key", "in", part).execute();
    for (const r of rows) existing.add(r.dedupe_key);
  }
  const fresh = candidates.filter((c) => !existing.has(c.key));
  result.duplicates += candidates.length - fresh.length;

  const room = remaining(await countUserKeywords(project.userId), entitlements.maxKeywords);
  const toAdd = Number.isFinite(room) ? fresh.slice(0, room) : fresh;
  result.overLimit = fresh.length - toAdd.length;
  if (!toAdd.length) return result;

  const ts = now();
  for (let i = 0; i < toAdd.length; i += 200) {
    const part = toAdd.slice(i, i + 200);
    try {
      await db
        .insertInto("keywords")
        .values(
          part.map((c) => ({
            project_id: project.id,
            phrase: c.phrase,
            country: c.country,
            language: c.language,
            device: c.device,
            location: c.location,
            dedupe_key: c.key,
            tags: JSON.stringify(c.tags),
            target_url: c.targetUrl,
            status: "active" as const,
            last_checked_at: null,
            last_position: null,
            best_position: null,
            start_position: null,
            last_url: null,
            last_features: "[]",
            next_check_at: ts,
            fail_count: 0,
            last_error: null,
            created_at: ts,
            updated_at: ts,
          })),
        )
        .execute();
      result.added += part.length;
    } catch {
      // A concurrent request added some of them: insert one by one and skip the duplicates.
      for (const c of part) {
        try {
          await db
            .insertInto("keywords")
            .values({
              project_id: project.id,
              phrase: c.phrase,
              country: c.country,
              language: c.language,
              device: c.device,
              location: c.location,
              dedupe_key: c.key,
              tags: JSON.stringify(c.tags),
              target_url: c.targetUrl,
              status: "active",
              last_checked_at: null,
              last_position: null,
              best_position: null,
              start_position: null,
              last_url: null,
              last_features: "[]",
              next_check_at: ts,
              fail_count: 0,
              last_error: null,
              created_at: ts,
              updated_at: ts,
            })
            .execute();
          result.added += 1;
        } catch {
          result.duplicates += 1;
        }
      }
    }
  }
  const keys = toAdd.map((c) => c.key);
  const idByKey = new Map<string, number>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await db.selectFrom("keywords").select(["id", "dedupe_key"]).where("project_id", "=", project.id).where("dedupe_key", "in", keys.slice(i, i + 500)).execute();
    for (const r of rows) idByKey.set(r.dedupe_key, r.id);
  }
  result.ids = keys.map((k) => idByKey.get(k)).filter((id): id is number => id !== undefined);
  if (entitlements.maxKeywords > 0 && (result.added || result.overLimit)) {
    await checkQuotaAlerts(project.userId, "keywords", await countUserKeywords(project.userId), entitlements.maxKeywords);
  }
  return result;
}

export interface KeywordListOptions {
  status?: KeywordStatus;
  /** Only keywords with this tag (case-insensitive). */
  tag?: string;
  /** Substring of the phrase. */
  search?: string;
  sort?: "phrase" | "position" | "best" | "created";
  limit?: number;
  offset?: number;
}

/**
 * Keywords of a project with their latest positions (keywords.last_position / best / start /
 * last_url are kept up to date by the rank job). Position sort puts not-ranked keywords last.
 */
export async function listProjectKeywords(projectId: number, options: KeywordListOptions = {}): Promise<{ total: number; keywords: KeywordRecord[] }> {
  const db = await getDb();
  let q = db.selectFrom("keywords").where("project_id", "=", projectId);
  if (options.status) q = q.where("status", "=", options.status);
  const rows = await q.selectAll().execute();
  let list = rows.map(toKeywordRecord);
  // Search and tag filters run here (a project has at most a few thousand keywords), which keeps
  // LIKE escaping differences between MySQL and SQLite out of the way.
  const search = normalizeKeyword(options.search ?? "");
  if (search) list = list.filter((k) => k.phrase.includes(search));
  const tag = str(options.tag ?? "", "", 40).toLowerCase();
  if (tag) list = list.filter((k) => k.tags.some((t) => t.toLowerCase() === tag));
  const sort = options.sort ?? "phrase";
  const pos = (p: number | null) => (p === null ? Number.MAX_SAFE_INTEGER : p);
  list.sort((a, b) => {
    switch (sort) {
      case "position":
        return pos(a.lastPosition) - pos(b.lastPosition) || a.phrase.localeCompare(b.phrase);
      case "best":
        return pos(a.bestPosition) - pos(b.bestPosition) || a.phrase.localeCompare(b.phrase);
      case "created":
        return b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
      default:
        return a.phrase.localeCompare(b.phrase) || a.id - b.id;
    }
  });
  const total = list.length;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
  return { total, keywords: list.slice(offset, offset + limit) };
}

/** Keywords of a project by id, in the order of `ids` (unknown ids and other projects' keywords are left out). */
export async function getProjectKeywordsByIds(projectId: number, ids: number[]): Promise<KeywordRecord[]> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return [];
  const db = await getDb();
  const byId = new Map<number, KeywordRecord>();
  for (let i = 0; i < clean.length; i += 500) {
    const rows = await db.selectFrom("keywords").selectAll().where("project_id", "=", projectId).where("id", "in", clean.slice(i, i + 500)).execute();
    for (const r of rows) byId.set(r.id, toKeywordRecord(r));
  }
  return clean.map((id) => byId.get(id)).filter((k): k is KeywordRecord => k !== undefined);
}

/** One keyword of a project, or undefined. */
export async function getProjectKeyword(projectId: number, keywordId: number): Promise<KeywordRecord | undefined> {
  if (!Number.isInteger(keywordId) || keywordId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("keywords").selectAll().where("id", "=", keywordId).where("project_id", "=", projectId).executeTakeFirst();
  return row ? toKeywordRecord(row) : undefined;
}

/** Distinct tags used in a project, sorted. */
export async function getProjectTags(projectId: number): Promise<string[]> {
  const db = await getDb();
  const rows = await db.selectFrom("keywords").select("tags").where("project_id", "=", projectId).execute();
  const byLower = new Map<string, string>();
  for (const r of rows) for (const t of parseJsonList(r.tags)) if (!byLower.has(t.toLowerCase())) byLower.set(t.toLowerCase(), t);
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}

/** Positions of keywords on given UTC days (rankings rows): keyword id → day → position (null = not ranked). */
export async function getPositionsOnDays(keywordIds: number[], days: string[]): Promise<Map<number, Map<string, number | null>>> {
  const out = new Map<number, Map<string, number | null>>();
  if (!keywordIds.length || !days.length) return out;
  const db = await getDb();
  for (let i = 0; i < keywordIds.length; i += 500) {
    const rows = await db
      .selectFrom("rankings")
      .select(["keyword_id", "day", "position"])
      .where("keyword_id", "in", keywordIds.slice(i, i + 500))
      .where("day", "in", days)
      .execute();
    for (const r of rows) {
      let m = out.get(r.keyword_id);
      if (!m) out.set(r.keyword_id, (m = new Map()));
      m.set(r.day, r.position === null ? null : Number(r.position));
    }
  }
  return out;
}

/** Update tags / target URL of keywords of a project. Returns how many were changed. */
export async function updateKeywords(
  project: Pick<ProjectRecord, "id" | "domain">,
  ids: number[],
  input: { tags?: string[]; targetUrl?: string | null },
): Promise<number> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return 0;
  const set: { tags?: string; target_url?: string | null; updated_at: string } = { updated_at: now() };
  if (input.tags !== undefined) set.tags = JSON.stringify(normalizeTags(input.tags));
  if (input.targetUrl !== undefined) set.target_url = input.targetUrl === null ? null : normalizeTargetUrl(input.targetUrl, project.domain);
  const db = await getDb();
  let changed = 0;
  for (let i = 0; i < clean.length; i += 500) {
    const res = await db.updateTable("keywords").set(set).where("project_id", "=", project.id).where("id", "in", clean.slice(i, i + 500)).executeTakeFirst();
    changed += Number(res.numUpdatedRows ?? 0);
  }
  return changed;
}

/** Pause or resume keywords of a project. Resumed keywords are checked on the next tick. */
export async function setKeywordsStatus(projectId: number, ids: number[], status: KeywordStatus): Promise<number> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return 0;
  const db = await getDb();
  const ts = now();
  let changed = 0;
  for (let i = 0; i < clean.length; i += 500) {
    const res = await db
      .updateTable("keywords")
      .set(status === "active" ? { status, next_check_at: ts, fail_count: 0, updated_at: ts } : { status, updated_at: ts })
      .where("project_id", "=", projectId)
      .where("id", "in", clean.slice(i, i + 500))
      .where("status", "!=", status)
      .executeTakeFirst();
    changed += Number(res.numUpdatedRows ?? 0);
  }
  return changed;
}

/** Delete keywords of a project with their rankings and SERP snapshots. */
export async function deleteKeywords(projectId: number, ids: number[]): Promise<number> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return 0;
  const db = await getDb();
  let deleted = 0;
  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < clean.length; i += 500) {
      const owned = (await trx.selectFrom("keywords").select("id").where("project_id", "=", projectId).where("id", "in", clean.slice(i, i + 500)).execute()).map((r) => r.id);
      if (!owned.length) continue;
      await trx.deleteFrom("serp_snapshots").where("keyword_id", "in", owned).execute();
      await trx.deleteFrom("rankings").where("keyword_id", "in", owned).execute();
      const res = await trx.deleteFrom("keywords").where("id", "in", owned).executeTakeFirst();
      deleted += Number(res.numDeletedRows ?? 0);
    }
  });
  return deleted;
}
