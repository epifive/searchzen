import { apiError, apiGuard, apiJson } from "@/lib/api-guard";
import { pathId, toApiProject } from "@/lib/api-v1";
import { getGscTotals, lastGscDay } from "@/lib/gsc/data";
import { getAuditDigest, getRankStats } from "@/lib/overview";
import { periodDays } from "@/lib/periods";
import { getOwnedProject, getProjectSummaries } from "@/lib/projects";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";

/** GET /api/v1/projects/{id}: one project with its settings and headline numbers. */

export const dynamic = "force-dynamic";

const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard.response;
  const project = await getOwnedProject(pathId((await params).id), guard.user.id);
  if (!project) return apiError(404, "Project not found.");
  const [summaries, audit, stats] = await Promise.all([getProjectSummaries([project.id]), getAuditDigest(project.id, 10), getRankStats([project.id], periodDays(8))]);
  const s = summaries.get(project.id);
  const week = stats.get(project.id);
  let gsc = null;
  if (project.gscProperty) {
    const end = (await lastGscDay(project.id)) ?? shift(new Date().toISOString().slice(0, 10), -2);
    const totals = await getGscTotals(project.id, shift(end, -27), end);
    gsc = { property: project.gscProperty, period: { from: shift(end, -27), to: end }, clicks: totals.clicks, impressions: totals.impressions, ctr: Math.round(totals.ctr * 10000) / 10000, position: totals.position };
  }
  const st = project.settings;
  const site = await getSettings();
  return apiJson({
    data: {
      ...toApiProject(project, s?.keywords ?? 0),
      settings: {
        country: st.country,
        language: st.language,
        device: st.device,
        location: st.location,
        competitors: st.competitors,
        check_frequency: st.checkFrequency,
        audit_schedule: st.auditSchedule,
      },
      summary: {
        ranked: s?.ranked ?? 0,
        top3: s?.top3 ?? 0,
        top10: s?.top10 ?? 0,
        average_position: s?.averagePosition ?? null,
        visibility: s?.visibility ?? 0,
        keywords_up_7d: week?.up ?? 0,
        keywords_down_7d: week?.down ?? 0,
      },
      last_audit: audit
        ? { id: audit.id, score: audit.score, finished_at: audit.finishedAt, pages_crawled: audit.pagesCrawled, critical: audit.critical, warning: audit.warning, notice: audit.notice, new_issues: audit.newIssues, fixed_issues: audit.fixedIssues }
        : null,
      search_console: gsc,
      share_url: project.shareToken ? absoluteUrl(site, `/r/${project.shareToken}`) : null,
    },
  });
}
