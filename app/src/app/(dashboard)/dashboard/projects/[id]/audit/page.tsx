import type { Metadata } from "next";
import Link from "next/link";
import { CircleStop, Download, Play, ScanSearch } from "lucide-react";
import { cancelAuditAction, startAuditAction } from "@/app/actions/dashboard/audits";
import { ActionButton } from "@/components/dashboard/actions";
import { AuditNav, AuditStatusBadge, auditBase, CategoryBars, issueTitle, ScoreChange, ScoreGauge, SEVERITY_DOT, SeverityBadge, TextLink, UrlText } from "@/components/dashboard/audit-kit";
import { AuditProgress } from "@/components/dashboard/audit-progress";
import { Num } from "@/components/dashboard/kit";
import { DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { readAuditSettings } from "@/lib/audit/store";
import { issueGroups, type AuditStatusInfo } from "@/lib/audit/service";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/dash-format";
import { requireProject } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural, type Translator } from "@/lib/i18n/messages";
import { getEntitlements } from "@/lib/plans";
import { getUsage } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { effectivePageLimit } from "@/seo/normalize";
import { ISSUE_CATEGORIES, type IssueCategory, type Severity } from "@/seo/types";
import { loadAuditContext } from "./_data";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ audit?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("dash.nav.audit")}` };
}

async function siteFacts(auditId: number) {
  const db = await getDb();
  const row = await db.selectFrom("audits").select("settings").where("id", "=", auditId).executeTakeFirst();
  return row ? readAuditSettings(row.settings).site ?? null : null;
}

function SiteChecks({ audit, facts, t, locale }: { audit: AuditStatusInfo; facts: Awaited<ReturnType<typeof siteFacts>>; t: Translator; locale: string }) {
  if (!facts) return null;
  const state = (ok: boolean | null, okText: string, badText: string) =>
    ok === null ? <Badge>{t("audit.site.unknown")}</Badge> : ok ? <Badge tone="success">{okText}</Badge> : <Badge tone="warning">{badText}</Badge>;
  const robots = facts.robotsTxt;
  const sitemap = facts.sitemap;
  return (
    <dl className="divide-y divide-line text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
        <dt className="text-muted">{t("audit.site.start")}</dt>
        <dd className="min-w-0">
          <UrlText url={audit.startUrl} />
        </dd>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <dt className="text-muted">{t("audit.site.https")}</dt>
        <dd>{state(facts.https, t("audit.site.yes"), t("audit.site.no"))}</dd>
      </div>
      {facts.https ? (
        <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <dt className="text-muted">
            <bdi dir="ltr">{t("audit.site.httpRedirect")}</bdi>
          </dt>
          <dd>{state(facts.httpRedirectsToHttps, t("audit.site.yes"), t("audit.site.no"))}</dd>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <dt className="text-muted">{t("audit.site.robots")}</dt>
        <dd>{robots === null ? state(null, "", "") : !robots.found ? state(false, "", t("audit.site.missing")) : state(robots.valid, t("audit.site.found"), t("audit.site.invalid"))}</dd>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 last:pb-0">
        <dt className="text-muted">{t("audit.site.sitemap")}</dt>
        <dd className="flex items-center gap-2">
          {sitemap?.found ? <span className="text-xs text-muted">{plural(t, "audit.site.urls", sitemap.urls, { n: sitemap.urls.toLocaleString(locale) })}</span> : null}
          {sitemap === null ? state(null, "", "") : !sitemap.found ? state(false, "", t("audit.site.missing")) : state(sitemap.valid, t("audit.site.found"), t("audit.site.invalid"))}
        </dd>
      </div>
    </dl>
  );
}

export default async function AuditPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [ctx, t, locale] = await Promise.all([loadAuditContext(id, query.audit), getT(), getLocale()]);
  const { project, running, selected, audits, user } = ctx;
  const lc = locale.code;
  const base = auditBase(project.id);
  const [entitlements, usage] = await Promise.all([getEntitlements(user), getUsage(user.id)]);
  const pageLimit = effectivePageLimit(project.settings.auditPageLimit, entitlements.maxAuditPages);
  const limitHint =
    entitlements.maxAuditsMonthly > 0
      ? t("audit.limitHint", { pages: pageLimit.toLocaleString(lc), used: usage.audits.toLocaleString(lc), limit: entitlements.maxAuditsMonthly.toLocaleString(lc) })
      : t("audit.limitHintUnlimited", { pages: pageLimit.toLocaleString(lc) });

  const start = running ? null : (
    <ActionButton action={startAuditAction} fields={{ project_id: project.id }} variant="primary" size="md" showSuccess>
      <Play aria-hidden />
      {audits.length ? t("audit.startAgain") : t("audit.start")}
    </ActionButton>
  );
  const done = selected?.status === "done" && !selected.pruned ? selected : null;
  const groups = done ? issueGroups(done) : [];
  const facts = done ? await siteFacts(done.id) : null;
  const categories = ISSUE_CATEGORIES.map((category) => {
    const counts: Record<Severity, number> = { critical: 0, warning: 0, notice: 0 };
    for (const g of groups) if (g.category === category) counts[g.severity] += g.pages;
    return { category: category as IssueCategory, counts };
  }).filter((r) => r.counts.critical + r.counts.warning + r.counts.notice > 0);
  const exportHref = (type: "issues" | "pages") => `${base}/export?type=${type}&audit=${done?.id ?? 0}`;
  const scoreChange = done?.diff?.previousScore !== null && done?.diff?.previousScore !== undefined && done.score !== null ? done.score - done.diff.previousScore : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <AuditNav projectId={project.id} active="overview" query={ctx.query} t={t} />
        <div className="flex flex-col items-end gap-1">
          {audits.length ? start : null}
          {start && audits.length ? <p className="text-end text-xs text-muted">{limitHint}</p> : null}
        </div>
      </div>

      {running ? (
        <Panel
          title={
            <span className="flex items-center gap-2">
              {t("audit.progress.title")} <AuditStatusBadge status={running.status} t={t} />
            </span>
          }
          description={running.startedAt || running.createdAt ? t("audit.progress.elapsed", { time: formatDateTime(running.startedAt ?? running.createdAt, lc) }) : undefined}
          actions={
            <ActionButton action={cancelAuditAction} fields={{ project_id: project.id, audit_id: running.id }} confirmText={t("audit.cancelConfirm")} buttonClassName="hover:border-red-300 hover:text-red-600">
              <CircleStop aria-hidden />
              {t("audit.cancel")}
            </ActionButton>
          }
        >
          <AuditProgress
            projectId={project.id}
            auditId={running.id}
            locale={lc}
            initial={{ status: running.status, pagesCrawled: running.pagesCrawled, pagesLimit: running.pagesLimit, queued: running.queued, score: null, error: null }}
          />
        </Panel>
      ) : null}

      {!selected && !running ? (
        <Panel>
          <Empty icon={<ScanSearch />} title={t("audit.emptyTitle")} action={start}>
            <p>{t("audit.emptyText", { domain: project.domain })}</p>
            <p className="mt-2 text-xs">{limitHint}</p>
          </Empty>
        </Panel>
      ) : null}

      {selected?.status === "failed" ? <Alert tone="error">{t("audit.failed", { error: selected.error ?? "" })}</Alert> : null}
      {selected?.status === "cancelled" ? <Alert tone="warning">{t("audit.cancelledText", { n: selected.pagesCrawled.toLocaleString(lc) })}</Alert> : null}
      {selected?.pruned ? <Alert tone="info">{t("audit.pruned")}</Alert> : null}

      {done ? (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel
              title={t("audit.score")}
              description={done.finishedAt ? t("audit.finishedAt", { date: formatDateTime(done.finishedAt, lc) }) : undefined}
              actions={
                <details className="group relative">
                  <summary className={cn(buttonClass("outline", "sm"), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                    <Download aria-hidden />
                    {t("audit.export")}
                  </summary>
                  <div className="absolute end-0 z-20 mt-1 w-44 rounded-lg border border-line bg-surface p-1 shadow-lg">
                    <a href={exportHref("issues")} className="block rounded-md px-3 py-2 text-sm hover:bg-primary-soft">
                      {t("audit.export.issues")}
                    </a>
                    <a href={exportHref("pages")} className="block rounded-md px-3 py-2 text-sm hover:bg-primary-soft">
                      {t("audit.export.pages")}
                    </a>
                  </div>
                </details>
              }
            >
              <div className="flex flex-wrap items-center gap-5">
                <ScoreGauge score={done.score} t={t} />
                <div className="min-w-0 flex-1 space-y-2">
                  <ScoreChange change={scoreChange} t={t} />
                  {done.diff ? (
                    <p className="flex flex-wrap gap-2 text-xs">
                      <Link href={`${base}/issues?change=new${ctx.query ? `&${ctx.query.slice(1)}` : ""}`} className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 hover:underline dark:bg-red-950 dark:text-red-300">
                        {t("audit.newIssues", { n: done.diff.newIssues.toLocaleString(lc) })}
                      </Link>
                      <Link href={`${base}/issues?change=fixed${ctx.query ? `&${ctx.query.slice(1)}` : ""}`} className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 hover:underline dark:bg-emerald-950 dark:text-emerald-300">
                        {t("audit.fixedIssues", { n: done.diff.fixedIssues.toLocaleString(lc) })}
                      </Link>
                    </p>
                  ) : null}
                  <p className="text-sm text-muted">
                    <Num value={done.pagesCrawled} locale={lc} className="font-semibold text-ink" /> {t("audit.kpi.pages").toLowerCase()}
                  </p>
                  <p dir="auto" className="text-xs text-muted">{plural(t, "audit.kpi.withIssues", done.summary.pagesWithIssues, { n: done.summary.pagesWithIssues.toLocaleString(lc) })}</p>
                </div>
              </div>
              <ul className="mt-5 grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ["critical", "audit.kpi.critical", done.summary.critical],
                    ["warning", "audit.kpi.warnings", done.summary.warning],
                    ["notice", "audit.kpi.notices", done.summary.notice],
                  ] as const
                ).map(([sev, label, value]) => (
                  <li key={sev}>
                    <Link href={`${base}/issues?severity=${sev}${ctx.query ? `&${ctx.query.slice(1)}` : ""}`} className="block rounded-lg border border-line px-2 py-2.5 hover:border-primary-line">
                      <span className="flex items-center justify-center gap-1.5 text-xs text-muted">
                        <span className={cn("size-2 rounded-full", SEVERITY_DOT[sev])} aria-hidden />
                        {t(label)}
                      </span>
                      <Num value={value} locale={lc} className="mt-0.5 block font-display text-xl font-bold" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={t("audit.categories")}>
              {categories.length ? <CategoryBars rows={categories} t={t} locale={lc} /> : <p className="text-sm text-muted">{t("audit.issues.cleanTitle")}</p>}
            </Panel>
            <Panel title={t("audit.site.title")}>
              <SiteChecks audit={done} facts={facts} t={t} locale={lc} />
            </Panel>
          </div>

          <Panel title={t("audit.topIssues")} actions={<TextLink href={`${base}/issues${ctx.query}`}>{t("audit.viewAll")}</TextLink>} padded={false}>
            {groups.filter((g) => g.pages > 0).length ? (
              <ul className="divide-y divide-line">
                {groups
                  .filter((g) => g.pages > 0)
                  .slice(0, 8)
                  .map((g) => (
                    <li key={g.code}>
                      <Link href={`${base}/issues?code=${g.code}${ctx.query ? `&${ctx.query.slice(1)}` : ""}#${g.code}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-paper">
                        <SeverityBadge severity={g.severity} t={t} />
                        <span className="min-w-0 flex-1 text-sm font-medium">{issueTitle(t, g.code)}</span>
                        {g.newCount ? <Badge tone="danger">{t("audit.newIssues", { n: g.newCount.toLocaleString(lc) })}</Badge> : null}
                        <span dir="auto" className="text-sm text-muted">{g.site ? t("audit.issues.site") : plural(t, "audit.issues.pages", g.pages, { n: g.pages.toLocaleString(lc) })}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            ) : (
              <Empty title={t("audit.issues.cleanTitle")} />
            )}
          </Panel>
        </>
      ) : null}

      {audits.length ? (
        <Panel title={t("audit.history")} padded={false}>
          <DTable minWidth={560} label={t("audit.history")}>
            <thead>
              <tr>
                <DTh>{t("audit.history.date")}</DTh>
                <DTh>{t("audit.history.status")}</DTh>
                <DTh>{t("audit.history.trigger")}</DTh>
                <DTh className="text-end">{t("audit.history.pages")}</DTh>
                <DTh className="text-end">{t("audit.history.score")}</DTh>
                <DTh />
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id} className={a.id === selected?.id ? "bg-primary-soft/40" : undefined}>
                  <DTd className="whitespace-nowrap">{formatDateTime(a.finishedAt ?? a.createdAt, lc)}</DTd>
                  <DTd>
                    <AuditStatusBadge status={a.status} t={t} />
                  </DTd>
                  <DTd className="text-muted">{t(`audit.trigger.${a.trigger}`)}</DTd>
                  <DTd className="text-end">
                    <Num value={a.pagesCrawled} locale={lc} />
                  </DTd>
                  <DTd className="text-end font-semibold">
                    <bdi>{a.score ?? "–"}</bdi>
                  </DTd>
                  <DTd className="text-end">
                    {a.id === selected?.id ? (
                      <span className="text-xs text-muted">{t("audit.history.current")}</span>
                    ) : a.status === "done" || a.status === "cancelled" || a.status === "failed" ? (
                      <TextLink href={`${base}?audit=${a.id}`}>{t("audit.history.view")}</TextLink>
                    ) : null}
                  </DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
        </Panel>
      ) : null}
    </div>
  );
}
