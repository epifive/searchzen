import "server-only";
import { sql, type Kysely } from "kysely";
import { buildAlertPayload, notifyChannels } from "@/lib/alerts";
import { getDb, now } from "@/lib/db";
import type { Database } from "@/lib/db/schema";
import { getProject } from "@/lib/projects";
import { healthScore } from "@/seo/normalize";
import type { AuditSummary, Severity } from "@/seo/types";
import { AUDIT_CHECKS } from "./checks";
import { dupKey, indexable } from "./checks/helpers";
import { ACTIVE_STATUSES, readAuditSettings, toCrawledPage, type AuditDiff } from "./store";
import type { CrawledPage, SiteContext } from "./types";

/**
 * The analysis phase: runs every check of the registry over the crawled pages (page checks)
 * and once over the site (site checks), computes inlinks and click depth from the link graph,
 * stores the issues, the summary, the health score and the change since the previous audit,
 * then sends the audit alert and prunes old audits. Re-running it gives the same result, so a
 * tick that dies half-way is simply repeated.
 */

/** Finished audits kept with all their pages and issues per project (older ones keep only their score). */
export const KEEP_AUDITS = 10;

interface IssueRow {
  pageIndex: number | null;
  code: string;
  severity: Severity;
  details: string;
}

/** Click depth from the start page over internal links (a redirect costs no click). */
function clickDepths(pages: CrawledPage[], byUrl: Map<string, number>, start: number): Map<number, number> {
  const dist = new Map<number, number>([[start, 0]]);
  // 0-1 BFS: redirect edges at the front, links at the back.
  const queue: number[] = [start];
  while (queue.length) {
    const i = queue.shift()!;
    const d = dist.get(i)!;
    const page = pages[i];
    if (page.redirects.length && !page.redirectLoop) {
      const j = byUrl.get(page.finalUrl);
      if (j !== undefined && (dist.get(j) ?? Infinity) > d) {
        dist.set(j, d);
        queue.unshift(j);
      }
    }
    for (const link of page.internalLinks) {
      const j = byUrl.get(link);
      if (j !== undefined && (dist.get(j) ?? Infinity) > d + 1) {
        dist.set(j, d + 1);
        queue.push(j);
      }
    }
  }
  return dist;
}

function caseUpdate<T extends string | number>(column: "inlinks" | "depth" | "issues", values: Array<[number, T]>) {
  return sql<T>`CASE ${sql.ref("id")} ${sql.join(
    values.map(([id, v]) => sql`WHEN ${id} THEN ${v}`),
    sql` `,
  )} ELSE ${sql.ref(column)} END`;
}

export async function analyzeAudit(auditId: number): Promise<void> {
  const db = await getDb();
  const audit = await db.selectFrom("audits").selectAll().where("id", "=", auditId).executeTakeFirst();
  if (!audit || audit.status !== "analyzing") return;
  const settings = readAuditSettings(audit.settings);
  const facts = settings.site;
  const rows = await db.selectFrom("audit_pages").select(["id", "url", "status_code", "depth", "inlinks", "data"]).where("audit_id", "=", auditId).orderBy("id").execute();
  if (!facts || !rows.length) {
    await failAudit(auditId, "No page could be crawled.");
    return;
  }
  const pages = rows.map(toCrawledPage);
  const byUrl = new Map(pages.map((p, i) => [p.url, i]));

  // Inlinks: distinct crawled HTML pages linking to a page (self-links excluded). A link to a
  // redirecting URL also counts for the redirect's target, so it isn't reported as an orphan.
  const inlinks = new Array<number>(pages.length).fill(0);
  for (const page of pages) {
    if (!page.isHtml) continue;
    const targets = new Set<number>();
    for (const link of page.internalLinks) {
      const j = byUrl.get(link);
      if (j === undefined || link === page.url) continue;
      targets.add(j);
      const target = pages[j];
      if (target.redirects.length && !target.redirectLoop) {
        const k = byUrl.get(target.finalUrl);
        if (k !== undefined && target.finalUrl !== page.url) targets.add(k);
      }
    }
    for (const j of targets) inlinks[j]++;
  }
  const startIndex = Math.max(0, rows.findIndex((r) => Number(r.depth) === 0));
  const depths = clickDepths(pages, byUrl, startIndex);
  pages.forEach((p, i) => {
    p.inlinks = inlinks[i];
    p.depth = depths.get(i) ?? p.depth;
  });

  // Context for the checks.
  const statusByUrl = new Map<string, number | null>(pages.map((p) => [p.url, p.statusCode]));
  const capped = await db.selectFrom("audit_queue").select("id").where("audit_id", "=", auditId).where("state", "=", "skipped").where("depth", ">=", 0).limit(1).executeTakeFirst();
  const externalRows = await db.selectFrom("audit_queue").select(["url", "state", "status_code"]).where("audit_id", "=", auditId).where("depth", "<", 0).execute();
  const externalStatus = new Map<string, number | null>();
  for (const e of externalRows) {
    if (e.state === "failed") externalStatus.set(e.url, null);
    else if (e.state === "done" && e.status_code !== null) externalStatus.set(e.url, Number(e.status_code));
  }
  const dupMap = (value: (p: CrawledPage) => string | null | undefined) => {
    const map = new Map<string, string[]>();
    for (const p of pages) {
      if (!indexable(p)) continue;
      const key = dupKey(value(p));
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(p.url);
      map.set(key, list);
    }
    for (const [k, v] of map) if (v.length < 2) map.delete(k);
    return map;
  };
  const ctx: SiteContext = {
    startUrl: settings.startUrl,
    host: facts.host,
    https: facts.https,
    robotsTxt: facts.robotsTxt,
    sitemap: facts.sitemap,
    httpRedirectsToHttps: facts.httpRedirectsToHttps,
    duplicateTitles: dupMap((p) => p.title),
    duplicateDescriptions: dupMap((p) => p.metaDescription),
    statusByUrl,
    facts,
    pagesByUrl: new Map(pages.map((p) => [p.url, p])),
    externalStatus,
    duplicateH1: dupMap((p) => p.h1[0]),
    sitemapUrls: new Set(pages.filter((p) => p.inSitemap).map((p) => p.url)),
    homeUrl: pages[startIndex].url,
    complete: !capped,
  };

  // Run the checks.
  const issues: IssueRow[] = [];
  const codesByPage: string[][] = pages.map(() => []);
  for (const check of AUDIT_CHECKS) {
    if (check.test) {
      pages.forEach((page, i) => {
        let found;
        try {
          found = check.test!(page, ctx);
        } catch {
          found = null;
        }
        const list = !found ? [] : Array.isArray(found) ? found : [found];
        if (!list.length) return;
        // One issue per page and code; extra findings are counted in the details.
        const details = { ...(list[0].details ?? {}), ...(list.length > 1 ? { count: list.length } : {}) };
        issues.push({ pageIndex: i, code: check.code, severity: check.severity, details: JSON.stringify(details) });
        codesByPage[i].push(check.code);
      });
    }
    if (check.testSite) {
      let found;
      try {
        found = check.testSite(ctx, pages);
      } catch {
        found = null;
      }
      const list = !found ? [] : Array.isArray(found) ? found : [found];
      if (list.length) issues.push({ pageIndex: null, code: check.code, severity: check.severity, details: JSON.stringify(list[0].details ?? {}) });
    }
  }

  // Summary and score.
  const summary: AuditSummary = { critical: 0, warning: 0, notice: 0, byCode: {}, pagesWithCritical: 0, pagesWithIssues: 0 };
  const critPages = new Set<number>();
  const issuePages = new Set<number>();
  for (const issue of issues) {
    summary[issue.severity]++;
    summary.byCode[issue.code] = (summary.byCode[issue.code] ?? 0) + 1;
    if (issue.pageIndex !== null) {
      issuePages.add(issue.pageIndex);
      if (issue.severity === "critical") critPages.add(issue.pageIndex);
    }
  }
  summary.pagesWithCritical = critPages.size;
  summary.pagesWithIssues = issuePages.size;
  const score = healthScore(
    issues.map((i) => ({ severity: i.severity, site: i.pageIndex === null })),
    pages.length,
  );

  // Change since the previous finished audit of the project.
  const diff = await diffWithPrevious(db, audit.project_id, auditId, issues.map((i) => `${i.code}|${i.pageIndex === null ? "" : pages[i.pageIndex].url}`));

  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("audit_issues").where("audit_id", "=", auditId).execute();
    for (let i = 0; i < issues.length; i += 200) {
      await trx
        .insertInto("audit_issues")
        .values(
          issues.slice(i, i + 200).map((issue) => ({
            audit_id: auditId,
            page_id: issue.pageIndex === null ? null : rows[issue.pageIndex].id,
            code: issue.code,
            severity: issue.severity,
            details: issue.details,
          })),
        )
        .execute();
    }
    for (let i = 0; i < rows.length; i += 100) {
      const part = rows.slice(i, i + 100).map((r, k) => ({ id: r.id, index: i + k }));
      await trx
        .updateTable("audit_pages")
        .set({
          inlinks: caseUpdate(
            "inlinks",
            part.map((p) => [p.id, pages[p.index].inlinks]),
          ),
          depth: caseUpdate(
            "depth",
            part.map((p) => [p.id, pages[p.index].depth]),
          ),
          issues: caseUpdate(
            "issues",
            part.map((p) => [p.id, JSON.stringify(codesByPage[p.index])]),
          ),
        })
        .where("id", "in", part.map((p) => p.id))
        .execute();
    }
  });
  const done = await db
    .updateTable("audits")
    .set({
      status: "done",
      score,
      pages_crawled: pages.length,
      issues_summary: JSON.stringify(diff ? { ...summary, diff } : summary),
      finished_at: now(),
      updated_at: now(),
      locked_until: null,
      error: null,
    })
    .where("id", "=", auditId)
    .where("status", "=", "analyzing")
    .executeTakeFirst();
  if (Number(done.numUpdatedRows) !== 1) return;
  await db.deleteFrom("audit_queue").where("audit_id", "=", auditId).execute();
  await sendAuditAlert(audit.project_id, auditId, "audit_finished", { score, pages: pages.length, summary, diff }).catch(() => undefined);
  await pruneAudits(audit.project_id).catch((e) => console.error("[searchzen] audit pruning failed:", e));
}

async function diffWithPrevious(db: Kysely<Database>, projectId: number, auditId: number, currentKeys: string[]): Promise<AuditDiff | null> {
  const previous = await db
    .selectFrom("audits")
    .select(["id", "score"])
    .where("project_id", "=", projectId)
    .where("status", "=", "done")
    .where("id", "<", auditId)
    .orderBy("id", "desc")
    .executeTakeFirst();
  if (!previous) return null;
  const prevRows = await db
    .selectFrom("audit_issues")
    .leftJoin("audit_pages", "audit_pages.id", "audit_issues.page_id")
    .select(["audit_issues.code", "audit_issues.page_id", "audit_pages.url"])
    .where("audit_issues.audit_id", "=", previous.id)
    .execute();
  const prevKeys = new Set(prevRows.filter((r) => r.page_id === null || r.url).map((r) => `${r.code}|${r.page_id === null ? "" : r.url}`));
  const current = new Set(currentKeys);
  const diff: AuditDiff = { previousAuditId: previous.id, previousScore: previous.score === null ? null : Number(previous.score), newIssues: 0, fixedIssues: 0, newByCode: {}, fixedByCode: {} };
  for (const key of current) {
    if (prevKeys.has(key)) continue;
    const code = key.slice(0, key.indexOf("|"));
    diff.newIssues++;
    diff.newByCode[code] = (diff.newByCode[code] ?? 0) + 1;
  }
  for (const key of prevKeys) {
    if (current.has(key)) continue;
    const code = key.slice(0, key.indexOf("|"));
    diff.fixedIssues++;
    diff.fixedByCode[code] = (diff.fixedByCode[code] ?? 0) + 1;
  }
  return diff;
}

/** Send audit_finished / audit_failed to the project's channels when "alert on audit" is on. */
async function sendAuditAlert(
  projectId: number,
  auditId: number,
  event: "audit_finished" | "audit_failed",
  facts: { score?: number; pages?: number; summary?: AuditSummary; diff?: AuditDiff | null; error?: string },
): Promise<void> {
  const project = await getProject(projectId);
  if (!project || !project.settings.alertOnAudit || !project.settings.alertChannelIds.length) return;
  const data: Record<string, number | string> = {};
  let message: string;
  if (event === "audit_finished") {
    const s = facts.summary!;
    data.score = facts.score ?? 0;
    if (facts.diff?.previousScore !== null && facts.diff?.previousScore !== undefined) data.previousScore = facts.diff.previousScore;
    data.pages = facts.pages ?? 0;
    data.critical = s.critical;
    data.warnings = s.warning;
    if (facts.diff) {
      data.newIssues = facts.diff.newIssues;
      data.fixedIssues = facts.diff.fixedIssues;
    }
    const change =
      facts.diff?.previousScore !== null && facts.diff?.previousScore !== undefined
        ? ` (${facts.score! - facts.diff.previousScore >= 0 ? "+" : ""}${facts.score! - facts.diff.previousScore} since the last audit)`
        : "";
    message = `The site audit of ${project.domain} finished: health score ${facts.score}/100${change}, ${s.critical} critical issues and ${s.warning} warnings on ${facts.pages} pages.`;
  } else {
    data.error = facts.error ?? "";
    message = `The site audit of ${project.domain} failed: ${facts.error ?? "unknown error"}`;
  }
  data.audit = auditId;
  const payload = await buildAlertPayload(project, event, message, data);
  payload.url = `${payload.url}/audit?audit=${auditId}`;
  await notifyChannels(project.settings.alertChannelIds, payload, project.id, project.userId);
}

/** Stop an active audit with an error (and send audit_failed). */
export async function failAudit(auditId: number, error: string, options: { silent?: boolean } = {}): Promise<void> {
  const db = await getDb();
  const audit = await db.selectFrom("audits").select(["project_id"]).where("id", "=", auditId).executeTakeFirst();
  const res = await db
    .updateTable("audits")
    .set({ status: "failed", error: error.slice(0, 500), finished_at: now(), updated_at: now(), locked_until: null })
    .where("id", "=", auditId)
    .where("status", "in", [...ACTIVE_STATUSES])
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) !== 1 || !audit) return;
  await db.deleteFrom("audit_queue").where("audit_id", "=", auditId).execute();
  await pruneAudits(audit.project_id).catch((e) => console.error("[searchzen] audit pruning failed:", e));
  if (!options.silent) await sendAuditAlert(audit.project_id, auditId, "audit_failed", { error }).catch(() => undefined);
}

/** Failed / cancelled audits whose (partial) pages and issues are kept per project. */
const KEEP_UNFINISHED_AUDITS = 5;

/**
 * Keep the pages and issues of the last KEEP_AUDITS done audits per project, and of the last
 * KEEP_UNFINISHED_AUDITS failed / cancelled ones (counted separately, so failed runs never push
 * out done audits). Older audits keep their score row only.
 */
export async function pruneAudits(projectId: number): Promise<number> {
  const db = await getDb();
  const finished = await db
    .selectFrom("audits")
    .select(["id", "status"])
    .where("project_id", "=", projectId)
    .where("status", "in", ["done", "failed", "cancelled"])
    .orderBy("id", "desc")
    .execute();
  const done = finished.filter((a) => a.status === "done");
  const unfinished = finished.filter((a) => a.status !== "done");
  const old = [...done.slice(KEEP_AUDITS), ...unfinished.slice(KEEP_UNFINISHED_AUDITS)].map((a) => a.id);
  if (!old.length) return 0;
  let removed = 0;
  for (let i = 0; i < old.length; i += 50) {
    const part = old.slice(i, i + 50);
    await db.deleteFrom("audit_issues").where("audit_id", "in", part).execute();
    const res = await db.deleteFrom("audit_pages").where("audit_id", "in", part).executeTakeFirst();
    await db.deleteFrom("audit_queue").where("audit_id", "in", part).execute();
    removed += Number(res.numDeletedRows ?? 0);
  }
  return removed;
}
