import "server-only";
import { sql } from "kysely";
import { getDb, now } from "@/lib/db";
import type { Audit } from "@/lib/db/schema";
import { getEntitlementsForUserId } from "@/lib/plans";
import { getProject } from "@/lib/projects";
import { checkQuotaAlerts } from "@/lib/alerts/quota";
import { getUsage, hasAuditQuota, incrementUsage } from "@/lib/usage";
import { effectivePageLimit, parseJson, parseJsonList } from "@/seo/normalize";
import type { AuditStatus, AuditSummary, AuditTrigger, CrawlSettings, IssueCategory, Severity } from "@/seo/types";
import { categoryOf, compareCodes, severityOf, SITE_CHECK_CODES } from "./checks";
import { ACTIVE_STATUSES, DEFAULT_MAX_DEPTH, emptySummaryJson, readAuditSettings, readSummary, toCrawledPage, writeAuditSettings, type AuditDiff } from "./store";
import type { CrawledPage } from "./types";

/**
 * The site audit service: what the dashboard, the REST API, reports and the scheduler use.
 * Every function takes ids that the caller has already checked belong to the user.
 *
 *   startAudit(projectId, trigger)        queue an audit (plan quota + page cap applied)
 *   cancelAudit(auditId)                  stop a running audit
 *   getAuditStatus(auditId)               status / progress / score of one audit
 *   getLatestAuditSummary(projectId)      the last finished audit (score, change, top issues) + the running one
 *   listAuditIssues(auditId, filters)     issue rows (page URL, severity, details), filterable
 *   listAudits / listAuditPages / getAuditPageDetail / issueGroups   for the dashboard
 */

export type StartAuditError = "not_found" | "running" | "quota" | "paused";

export type StartAuditResult = { ok: true; auditId: number } | { ok: false; error: StartAuditError; auditId?: number };

/** Queue a site audit of a project. The crawl itself runs in scheduler ticks (and while the audit page is open). */
export async function startAudit(projectId: number, trigger: AuditTrigger): Promise<StartAuditResult> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "not_found" };
  if (trigger === "schedule" && project.status === "paused") return { ok: false, error: "paused" };
  const db = await getDb();
  const active = async () =>
    db.selectFrom("audits").select("id").where("project_id", "=", projectId).where("status", "in", [...ACTIVE_STATUSES]).orderBy("id").execute();
  const running = await active();
  if (running.length) return { ok: false, error: "running", auditId: running[0].id };
  const entitlements = await getEntitlementsForUserId(project.userId);
  if (!(await hasAuditQuota(project.userId, entitlements))) return { ok: false, error: "quota" };
  const settings: CrawlSettings = {
    startUrl: `https://${project.domain}/`,
    pageLimit: effectivePageLimit(project.settings.auditPageLimit, entitlements.maxAuditPages),
    maxDepth: DEFAULT_MAX_DEPTH,
    crawlDelayMs: project.settings.crawlDelayMs,
    includePatterns: project.settings.includePatterns,
    excludePatterns: project.settings.excludePatterns,
    userAgent: project.settings.userAgent,
  };
  const ts = now();
  const result = await db
    .insertInto("audits")
    .values({
      project_id: projectId,
      status: "queued",
      triggered_by: trigger,
      settings: writeAuditSettings(settings),
      started_at: null,
      finished_at: null,
      pages_crawled: 0,
      pages_limit: settings.pageLimit,
      score: null,
      issues_summary: emptySummaryJson(),
      error: null,
      locked_until: null,
      created_at: ts,
      updated_at: ts,
    })
    .executeTakeFirstOrThrow();
  const auditId = Number(result.insertId);
  // Two starts at the same moment: the older audit wins.
  const now2 = await active();
  if (now2.length > 1 && now2[0].id !== auditId) {
    await db.deleteFrom("audits").where("id", "=", auditId).execute();
    return { ok: false, error: "running", auditId: now2[0].id };
  }
  await incrementUsage(project.userId, { audits: 1 });
  if (entitlements.maxAuditsMonthly > 0) await checkQuotaAlerts(project.userId, "audits", (await getUsage(project.userId)).audits, entitlements.maxAuditsMonthly);
  return { ok: true, auditId };
}

/** Cancel a queued / running audit; pages crawled so far are kept. */
export async function cancelAudit(auditId: number): Promise<boolean> {
  const db = await getDb();
  const res = await db
    .updateTable("audits")
    .set({ status: "cancelled", finished_at: now(), updated_at: now(), locked_until: null })
    .where("id", "=", auditId)
    .where("status", "in", [...ACTIVE_STATUSES])
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) !== 1) return false;
  await db.deleteFrom("audit_queue").where("audit_id", "=", auditId).execute();
  return true;
}

export interface AuditStatusInfo {
  id: number;
  projectId: number;
  status: AuditStatus;
  trigger: AuditTrigger;
  /** Pages crawled so far / the cap of this audit. */
  pagesCrawled: number;
  pagesLimit: number;
  /** URLs waiting in the frontier (running audits). */
  queued: number;
  /** Health score 0–100 once done. */
  score: number | null;
  summary: AuditSummary;
  /** Change since the previous finished audit (done audits that have one). */
  diff: AuditDiff | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Start URL after redirects, once known. */
  startUrl: string;
  /** Pages and issues were removed by retention (older audits keep only the score). */
  pruned: boolean;
}

function statusInfo(a: Audit, queued: number, pagesStored: number | null): AuditStatusInfo {
  const settings = readAuditSettings(a.settings);
  const summary = readSummary(a.issues_summary);
  const { diff, ...rest } = summary;
  return {
    id: a.id,
    projectId: a.project_id,
    status: a.status,
    trigger: a.triggered_by,
    pagesCrawled: Number(a.pages_crawled),
    pagesLimit: Number(a.pages_limit),
    queued,
    score: a.score === null ? null : Number(a.score),
    summary: rest,
    diff: diff ?? null,
    error: a.error,
    createdAt: a.created_at,
    startedAt: a.started_at,
    finishedAt: a.finished_at,
    startUrl: settings.site?.startRedirectedTo ?? settings.startUrl,
    pruned: pagesStored !== null && pagesStored === 0 && Number(a.pages_crawled) > 0,
  };
}

/** Status, progress and score of an audit, or null. */
export async function getAuditStatus(auditId: number): Promise<AuditStatusInfo | null> {
  if (!Number.isInteger(auditId) || auditId < 1) return null;
  const db = await getDb();
  const a = await db.selectFrom("audits").selectAll().where("id", "=", auditId).executeTakeFirst();
  if (!a) return null;
  let queued = 0;
  if ((ACTIVE_STATUSES as readonly string[]).includes(a.status)) {
    const row = await db
      .selectFrom("audit_queue")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("audit_id", "=", auditId)
      .where("state", "=", "pending")
      .where("depth", ">=", 0)
      .executeTakeFirst();
    queued = Number(row?.n ?? 0);
  }
  let stored: number | null = null;
  if (a.status === "done") {
    const row = await db.selectFrom("audit_pages").select("id").where("audit_id", "=", auditId).limit(1).executeTakeFirst();
    stored = row ? 1 : 0;
  }
  return statusInfo(a, queued, stored);
}

/** Audits of a project, newest first. */
export async function listAudits(projectId: number, limit = 20): Promise<AuditStatusInfo[]> {
  const db = await getDb();
  const rows = await db.selectFrom("audits").selectAll().where("project_id", "=", projectId).orderBy("id", "desc").limit(limit).execute();
  return rows.map((a) => statusInfo(a, 0, null));
}

/** The running audit of a project, if any. */
export async function getRunningAudit(projectId: number): Promise<AuditStatusInfo | null> {
  const db = await getDb();
  const a = await db.selectFrom("audits").select("id").where("project_id", "=", projectId).where("status", "in", [...ACTIVE_STATUSES]).orderBy("id", "desc").executeTakeFirst();
  return a ? getAuditStatus(a.id) : null;
}

export interface LatestAuditSummary {
  auditId: number;
  score: number | null;
  previousScore: number | null;
  /** score − previousScore (null without a previous audit). */
  scoreChange: number | null;
  finishedAt: string | null;
  pages: number;
  critical: number;
  warning: number;
  notice: number;
  newIssues: number | null;
  fixedIssues: number | null;
  /** The most frequent issues (critical first), at most 10. */
  topIssues: Array<{ code: string; severity: Severity; category: IssueCategory; pages: number }>;
  /** An audit currently queued / crawling / analysing, if any. */
  running: { auditId: number; status: AuditStatus; pagesCrawled: number; pagesLimit: number } | null;
}

/** The last finished audit of a project (for the overview, reports, badge and API), or null when none finished yet and none runs. */
export async function getLatestAuditSummary(projectId: number): Promise<LatestAuditSummary | null> {
  const db = await getDb();
  const [done, running] = await Promise.all([
    db.selectFrom("audits").selectAll().where("project_id", "=", projectId).where("status", "=", "done").orderBy("id", "desc").executeTakeFirst(),
    db
      .selectFrom("audits")
      .select(["id", "status", "pages_crawled", "pages_limit"])
      .where("project_id", "=", projectId)
      .where("status", "in", [...ACTIVE_STATUSES])
      .orderBy("id", "desc")
      .executeTakeFirst(),
  ]);
  if (!done && !running) return null;
  const run = running ? { auditId: running.id, status: running.status, pagesCrawled: Number(running.pages_crawled), pagesLimit: Number(running.pages_limit) } : null;
  if (!done) {
    return { auditId: 0, score: null, previousScore: null, scoreChange: null, finishedAt: null, pages: 0, critical: 0, warning: 0, notice: 0, newIssues: null, fixedIssues: null, topIssues: [], running: run };
  }
  const summary = readSummary(done.issues_summary);
  const score = done.score === null ? null : Number(done.score);
  const previousScore = summary.diff?.previousScore ?? null;
  const topIssues = Object.entries(summary.byCode)
    .sort(([a, na], [b, nb]) => compareCodes(a, b) || nb - na)
    .slice(0, 10)
    .map(([code, pages]) => ({ code, severity: severityOf(code), category: categoryOf(code), pages: Number(pages) }));
  return {
    auditId: done.id,
    score,
    previousScore,
    scoreChange: score !== null && previousScore !== null ? score - previousScore : null,
    finishedAt: done.finished_at,
    pages: Number(done.pages_crawled),
    critical: summary.critical,
    warning: summary.warning,
    notice: summary.notice,
    newIssues: summary.diff ? summary.diff.newIssues : null,
    fixedIssues: summary.diff ? summary.diff.fixedIssues : null,
    topIssues,
    running: run,
  };
}

// ── Issues ──

export interface IssueFilters {
  severity?: Severity;
  category?: IssueCategory;
  code?: string;
  /** "new": not in the previous audit; "fixed": in the previous audit but not in this one. */
  change?: "all" | "new" | "fixed";
  limit?: number;
  offset?: number;
}

export interface AuditIssueItem {
  /** audit_issues.id (of the previous audit for "fixed" issues). */
  id: number;
  code: string;
  severity: Severity;
  category: IssueCategory;
  /** null for site-wide issues. */
  pageId: number | null;
  url: string | null;
  details: Record<string, string | number | boolean>;
  /** Not present in the previous audit (null when there is no previous audit). */
  isNew: boolean | null;
}

const issueKey = (code: string, url: string | null) => `${code}|${url ?? ""}`;

async function issueKeys(auditId: number, code?: string): Promise<Set<string>> {
  const db = await getDb();
  let q = db
    .selectFrom("audit_issues")
    .leftJoin("audit_pages", "audit_pages.id", "audit_issues.page_id")
    .select(["audit_issues.code", "audit_pages.url"])
    .where("audit_issues.audit_id", "=", auditId);
  if (code) q = q.where("audit_issues.code", "=", code);
  const rows = await q.execute();
  return new Set(rows.map((r) => issueKey(r.code, r.url)));
}

/** Issues of an audit with their page URL, critical first. `total` counts all matching rows. */
export async function listAuditIssues(auditId: number, filters: IssueFilters = {}): Promise<{ total: number; issues: AuditIssueItem[] }> {
  const db = await getDb();
  const audit = await db.selectFrom("audits").select(["id", "issues_summary"]).where("id", "=", auditId).executeTakeFirst();
  if (!audit) return { total: 0, issues: [] };
  const diff = readSummary(audit.issues_summary).diff ?? null;
  const change = filters.change ?? "all";
  if (change !== "all" && !diff) return { total: 0, issues: [] };
  const source = change === "fixed" ? diff!.previousAuditId : auditId;
  const compareWith = change === "fixed" ? auditId : diff?.previousAuditId;
  const otherKeys = compareWith ? await issueKeys(compareWith, filters.code) : null;

  let q = db
    .selectFrom("audit_issues")
    .leftJoin("audit_pages", "audit_pages.id", "audit_issues.page_id")
    .select(["audit_issues.id", "audit_issues.code", "audit_issues.severity", "audit_issues.page_id", "audit_issues.details", "audit_pages.url"])
    .where("audit_issues.audit_id", "=", source);
  if (filters.severity) q = q.where("audit_issues.severity", "=", filters.severity);
  if (filters.code) q = q.where("audit_issues.code", "=", filters.code);
  const rows = await q.orderBy("audit_issues.id").execute();
  let items: AuditIssueItem[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    severity: (["critical", "warning", "notice"].includes(r.severity) ? r.severity : "notice") as Severity,
    category: categoryOf(r.code),
    pageId: r.page_id,
    url: r.url ?? null,
    details: parseJson(r.details) as Record<string, string | number | boolean>,
    isNew: otherKeys && change !== "fixed" ? !otherKeys.has(issueKey(r.code, r.url ?? null)) : null,
  }));
  if (filters.category) items = items.filter((i) => i.category === filters.category);
  if (change === "new") items = items.filter((i) => i.isNew);
  if (change === "fixed") items = items.filter((i) => !otherKeys!.has(issueKey(i.code, i.url)));
  items.sort((a, b) => compareCodes(a.code, b.code) || a.id - b.id);
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.min(Math.max(1, filters.limit ?? 100), 5000);
  return { total: items.length, issues: items.slice(offset, offset + limit) };
}

export interface IssueGroup {
  code: string;
  severity: Severity;
  category: IssueCategory;
  /** Affected pages (1 for site-wide issues). */
  pages: number;
  site: boolean;
  newCount: number | null;
  fixedCount: number | null;
}

/** One entry per issue code of an audit (plus codes fixed since the previous audit), critical first. */
export function issueGroups(status: Pick<AuditStatusInfo, "summary" | "diff">): IssueGroup[] {
  const codes = new Set([...Object.keys(status.summary.byCode), ...Object.keys(status.diff?.fixedByCode ?? {})]);
  return [...codes]
    .map((code) => ({
      code,
      severity: severityOf(code),
      category: categoryOf(code),
      pages: Number(status.summary.byCode[code] ?? 0),
      site: SITE_CHECK_CODES.has(code),
      newCount: status.diff ? Number(status.diff.newByCode[code] ?? 0) : null,
      fixedCount: status.diff ? Number(status.diff.fixedByCode[code] ?? 0) : null,
    }))
    .sort((a, b) => compareCodes(a.code, b.code) || b.pages - a.pages);
}

// ── Pages ──

export type PageStatusFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx" | "error" | "issues";

export interface PageFilters {
  status?: PageStatusFilter;
  /** Only pages with this issue code. */
  issue?: string;
  /** Text in the URL or title. */
  q?: string;
  sort?: "url" | "status" | "words" | "load" | "depth" | "inlinks" | "issues";
  limit?: number;
  offset?: number;
}

export interface AuditPageRow {
  id: number;
  url: string;
  statusCode: number | null;
  redirectTo: string | null;
  title: string | null;
  words: number;
  loadMs: number;
  depth: number;
  inlinks: number;
  issues: string[];
  contentType: string | null;
}

const likeEscape = (s: string) => s.replace(/[!%_]/g, (c) => `!${c}`);

export async function listAuditPages(auditId: number, filters: PageFilters = {}): Promise<{ total: number; pages: AuditPageRow[] }> {
  const db = await getDb();
  let q = db.selectFrom("audit_pages").where("audit_pages.audit_id", "=", auditId);
  switch (filters.status) {
    case "2xx":
      q = q.where("status_code", ">=", 200).where("status_code", "<", 300);
      break;
    case "3xx":
      q = q.where("status_code", ">=", 300).where("status_code", "<", 400);
      break;
    case "4xx":
      q = q.where("status_code", ">=", 400).where("status_code", "<", 500);
      break;
    case "5xx":
      q = q.where("status_code", ">=", 500);
      break;
    case "error":
      q = q.where("status_code", "is", null);
      break;
    case "issues":
      q = q.where("issues", "<>", "[]");
      break;
  }
  if (filters.issue && /^[a-z0-9_]{1,60}$/.test(filters.issue)) {
    const code = filters.issue;
    q = q.where((eb) => eb.exists(eb.selectFrom("audit_issues").select("audit_issues.id").whereRef("audit_issues.page_id", "=", "audit_pages.id").where("audit_issues.code", "=", code)));
  }
  const text = (filters.q ?? "").trim().slice(0, 200);
  if (text) {
    const pattern = `%${likeEscape(text.toLowerCase())}%`;
    q = q.where((eb) => eb.or([sql<boolean>`LOWER(${sql.ref("url")}) LIKE ${pattern} ESCAPE '!'`, sql<boolean>`LOWER(${sql.ref("title")}) LIKE ${pattern} ESCAPE '!'`]));
  }
  const totalRow = await q.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst();
  const sortCol = { url: "url", status: "status_code", words: "word_count", load: "load_ms", depth: "depth", inlinks: "inlinks", issues: "issues" } as const;
  const sort = filters.sort && sortCol[filters.sort] ? sortCol[filters.sort] : null;
  let rows = q.select(["id", "url", "status_code", "redirect_to", "title", "word_count", "load_ms", "depth", "inlinks", "issues", "content_type"]);
  if (sort === "issues") rows = rows.orderBy(sql`LENGTH(${sql.ref("issues")})`, "desc");
  else if (sort) rows = rows.orderBy(sort, sort === "url" || sort === "depth" ? "asc" : "desc");
  else rows = rows.orderBy("depth").orderBy("id");
  const limit = Math.min(Math.max(1, filters.limit ?? 50), 5000);
  const list = await rows
    .orderBy("id")
    .limit(limit)
    .offset(Math.max(0, filters.offset ?? 0))
    .execute();
  return {
    total: Number(totalRow?.n ?? 0),
    pages: list.map((r) => ({
      id: r.id,
      url: r.url,
      statusCode: r.status_code === null ? null : Number(r.status_code),
      redirectTo: r.redirect_to,
      title: r.title,
      words: Number(r.word_count),
      loadMs: Number(r.load_ms),
      depth: Number(r.depth),
      inlinks: Number(r.inlinks),
      issues: parseJsonList(r.issues),
      contentType: r.content_type,
    })),
  };
}

export interface AuditPageDetail {
  id: number;
  auditId: number;
  page: CrawledPage;
  issues: Array<{ code: string; severity: Severity; category: IssueCategory; details: Record<string, string | number | boolean> }>;
  /** Some pages linking here (up to 20). */
  linkedFrom: Array<{ id: number; url: string }>;
  fetchedAt: string;
}

export async function getAuditPageDetail(auditId: number, pageId: number): Promise<AuditPageDetail | null> {
  if (!Number.isInteger(pageId) || pageId < 1) return null;
  const db = await getDb();
  const row = await db.selectFrom("audit_pages").selectAll().where("id", "=", pageId).where("audit_id", "=", auditId).executeTakeFirst();
  if (!row) return null;
  const issues = await db.selectFrom("audit_issues").select(["code", "severity", "details"]).where("audit_id", "=", auditId).where("page_id", "=", pageId).execute();
  const needle = `%${likeEscape(JSON.stringify(row.url))}%`;
  const linkedFrom = await db
    .selectFrom("audit_pages")
    .select(["id", "url"])
    .where("audit_id", "=", auditId)
    .where("id", "<>", pageId)
    .where(sql<boolean>`${sql.ref("data")} LIKE ${needle} ESCAPE '!'`)
    .orderBy("depth")
    .orderBy("id")
    .limit(20)
    .execute();
  return {
    id: row.id,
    auditId,
    page: toCrawledPage(row),
    issues: issues
      .map((i) => ({ code: i.code, severity: severityOf(i.code), category: categoryOf(i.code), details: parseJson(i.details) as Record<string, string | number | boolean> }))
      .sort((a, b) => compareCodes(a.code, b.code)),
    linkedFrom,
    fetchedAt: row.fetched_at,
  };
}

// ── CSV export ──

/** A CSV cell: quoted, and text that a spreadsheet would run as a formula is prefixed with '. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",");

/** All issues of an audit as CSV (code, severity, category, URL, details, new). */
export async function issuesCsv(auditId: number): Promise<string> {
  const { issues } = await listAuditIssues(auditId, { limit: 5000 });
  const lines = [csvLine(["code", "severity", "category", "url", "details", "new"])];
  for (const i of issues) {
    lines.push(
      csvLine([
        i.code,
        i.severity,
        i.category,
        i.url ?? "(site)",
        Object.entries(i.details)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
        i.isNew === null ? "" : i.isNew ? "yes" : "no",
      ]),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** All pages of an audit as CSV. */
export async function pagesCsv(auditId: number): Promise<string> {
  const db = await getDb();
  const rows = await db.selectFrom("audit_pages").selectAll().where("audit_id", "=", auditId).orderBy("depth").orderBy("id").execute();
  const lines = [
    csvLine(["url", "status", "redirect_to", "content_type", "title", "meta_description", "h1_count", "words", "size_bytes", "load_ms", "depth", "inlinks", "internal_links", "external_links", "canonical", "robots", "issues"]),
  ];
  for (const r of rows) {
    lines.push(
      csvLine([
        r.url,
        r.status_code ?? "error",
        r.redirect_to ?? "",
        r.content_type ?? "",
        r.title ?? "",
        r.meta_description ?? "",
        r.h1_count,
        r.word_count,
        r.size_bytes,
        r.load_ms,
        r.depth,
        r.inlinks,
        r.internal_links,
        r.external_links,
        r.canonical ?? "",
        r.robots_meta ?? "",
        parseJsonList(r.issues).join(" "),
      ]),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
