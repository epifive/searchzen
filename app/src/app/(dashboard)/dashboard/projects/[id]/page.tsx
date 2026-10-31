import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, BellRing, FileText, LineChart as LineChartIcon, MousePointerClick, Plus, ScanSearch, Settings2 } from "lucide-react";
import { ChangeText, eventLabel, issueTitle, PositionText } from "@/components/dashboard/overview-bits";
import { LineChart } from "@/components/dashboard/overview-chart";
import { Delta, Kpi, KpiGrid, Num } from "@/components/dashboard/kit";
import { Empty, LinkTabs, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatNumber, formatRelative } from "@/lib/dash-format";
import { requireProject } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/messages";
import { getProjectOverview, topMovers, type Mover } from "@/lib/overview";
import { cn } from "@/lib/utils";
import { formatAveragePosition } from "@/seo/format";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; days?: string }> };

const PERIODS = [7, 30, 90] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("dash.nav.projectOverview")}` };
}

/** Project overview: KPIs, visibility and Search Console trends, top movers, the latest audit and recent alerts. */
export default async function ProjectOverviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const [{ project }, t, locale, query] = await Promise.all([requireProject(id), getT(), getLocale(), searchParams]);
  const days = PERIODS.find((p) => String(p) === query.days) ?? 30;
  const o = await getProjectOverview(project, days);
  const base = `/dashboard/projects/${project.id}`;
  const lc = locale.code;
  const movers = topMovers(o.rank.movers, 5);
  const visPrev = o.visibility.previous;
  const pct = (v: number) => `${formatNumber(v, lc, { maximumFractionDigits: 1 })}%`;
  const hasKeywords = o.keywords.total > 0;

  const moverList = (list: Mover[], empty: string) =>
    list.length ? (
      <ul className="divide-y divide-line">
        {list.map((m) => (
          <li key={m.keywordId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate text-sm font-medium">
                {m.phrase}
              </span>
              <span className="block truncate text-xs text-muted" dir="ltr">
                {m.country} · {t(m.device === "mobile" ? "dash.device.mobile" : "dash.device.desktop")}
              </span>
            </span>
            <span className="text-xs text-muted tabular-nums" dir="ltr">
              <PositionText position={m.previous} locale={lc} /> → <PositionText position={m.current} locale={lc} />
            </span>
            <ChangeText change={m.change} t={t} className="w-12 text-end" />
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted">{empty}</p>
    );

  return (
    <div className="space-y-6">
      {query.created ? <Alert tone="success">{t("dash.projects.created")}</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkTabs
          label={t("ov.period")}
          items={PERIODS.map((p) => ({ href: `${base}?days=${p}`, label: t("ov.lastDays", { n: p }), active: p === days }))}
        />
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`${base}/rankings`} size="sm" variant="outline">
            <Plus aria-hidden />
            {t("ov.qa.keywords")}
          </ButtonLink>
          <ButtonLink href={`${base}/audit`} size="sm" variant="outline">
            <ScanSearch aria-hidden />
            {t("ov.qa.audit")}
          </ButtonLink>
          <ButtonLink href={`${base}/reports`} size="sm" variant="outline">
            <FileText aria-hidden />
            {t("ov.qa.report")}
          </ButtonLink>
        </div>
      </div>

      <KpiGrid className="grid-cols-2 lg:grid-cols-5">
        <Kpi
          label={t("ov.kpi.visibility")}
          value={<bdi>{pct(o.visibility.now)}</bdi>}
          delta={hasKeywords && visPrev > 0 ? <Delta current={o.visibility.now} previous={visPrev} label={t("ov.vsStart")} /> : null}
          hint={t("ov.kpi.visibilityHint")}
        />
        <Kpi
          label={t("ov.kpi.avgPosition")}
          value={<bdi>{formatAveragePosition(o.averagePosition.now, lc)}</bdi>}
          hint={o.averagePosition.previous !== null ? t("ov.kpi.was", { value: formatAveragePosition(o.averagePosition.previous, lc) }) : plural(t, "ov.kpi.rankedOf", o.keywords.ranked, { n: o.keywords.ranked, total: o.keywords.active })}
        />
        <Kpi
          label={t("ov.kpi.movement")}
          value={
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                <ArrowUp className="size-4" aria-hidden />
                <Num value={o.rank.up} locale={lc} />
                <span className="sr-only">{t("ov.up")}</span>
              </span>
              <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400">
                <ArrowDown className="size-4" aria-hidden />
                <Num value={o.rank.down} locale={lc} />
                <span className="sr-only">{t("ov.down")}</span>
              </span>
            </span>
          }
          hint={t("ov.kpi.movementHint", { n: days })}
        />
        <Kpi
          label={t("ov.kpi.health")}
          value={o.audit?.score ?? "–"}
          delta={
            o.audit && o.audit.score !== null && o.audit.previousScore !== null && o.audit.score !== o.audit.previousScore ? (
              <bdi className={cn("text-xs font-semibold tabular-nums", o.audit.score > o.audit.previousScore ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")} title={t("ov.prevScore", { score: o.audit.previousScore })}>
                {o.audit.score > o.audit.previousScore ? "+" : "−"}
                {Math.abs(o.audit.score - o.audit.previousScore)}
              </bdi>
            ) : null
          }
          hint={o.audit ? t(`ov.grade.${o.audit.grade}`) : t("dash.home.noAudit")}
        />
        <div className="col-span-2 grid lg:col-span-1">
        <Kpi
          label={t("ov.kpi.clicks")}
          value={o.gsc ? <Num value={o.gsc.totals.clicks} locale={lc} /> : "–"}
          delta={o.gsc ? <Delta current={o.gsc.totals.clicks} previous={o.gsc.previous.clicks} label={t("ov.vsPrevious")} /> : null}
          hint={o.gsc ? t("ov.kpi.clicksHint", { n: days }) : t("ov.kpi.gscOff")}
        />
        </div>
      </KpiGrid>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("ov.visibilityTitle")} description={t("ov.visibilityText")}>
          {hasKeywords ? (
            <LineChart
              points={o.rank.series.map((p) => ({ day: p.day, value: p.tracked ? p.visibility : null }))}
              format="share"
              locale={lc}
              label={t("ov.kpi.visibility")}
              emptyText={t("ov.noRankData")}
            />
          ) : (
            <Empty icon={<LineChartIcon />} title={t("ov.noKeywordsTitle")} action={<ButtonLink href={`${base}/rankings`} size="sm">{t("ov.qa.keywords")}</ButtonLink>}>
              {t("ov.noKeywordsText")}
            </Empty>
          )}
        </Panel>
        <Panel
          title={t("ov.clicksTitle")}
          description={o.gsc ? <bdi dir="ltr">{o.gsc.property}</bdi> : t("ov.clicksText")}
          actions={o.gsc?.demo ? <Badge tone="warning">{t("gsc.demoData")}</Badge> : null}
        >
          {o.gsc ? (
            <LineChart points={o.gsc.series.map((d) => ({ day: d.day, value: d.clicks }))} format="number" locale={lc} label={t("gsc.metric.clicks")} emptyText={t("gsc.noData")} />
          ) : (
            <Empty icon={<MousePointerClick />} title={t("ov.gscTitle")} action={<ButtonLink href={`${base}/gsc`} size="sm">{t("ov.gscConnect")}</ButtonLink>}>
              {t("ov.gscText")}
            </Empty>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("ov.moversTitle")} description={t("ov.moversText", { n: days })} actions={<Link href={`${base}/rankings`} className="text-sm font-medium text-primary hover:underline">{t("ov.allKeywords")}</Link>}>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
                <ArrowUp className="size-3.5" aria-hidden />
                {t("ov.gainers")}
              </h3>
              {moverList(movers.up, t("ov.noGainers"))}
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-red-700 uppercase dark:text-red-400">
                <ArrowDown className="size-3.5" aria-hidden />
                {t("ov.losers")}
              </h3>
              {moverList(movers.down, t("ov.noLosers"))}
            </div>
          </div>
        </Panel>

        <Panel title={t("ov.auditTitle")} actions={<Link href={`${base}/audit`} className="text-sm font-medium text-primary hover:underline">{t("ov.openAudit")}</Link>}>
          {o.runningAudit ? (
            <Alert tone="info" className="mb-4">
              {t("ov.auditRunning", { pages: formatNumber(o.runningAudit.pagesCrawled, lc) })}
            </Alert>
          ) : null}
          {o.audit ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <span className={cn("grid size-16 shrink-0 place-items-center rounded-full text-2xl font-bold tabular-nums", o.audit.grade === "good" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : o.audit.grade === "fair" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300")}>
                  {o.audit.score ?? "–"}
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{t(`ov.grade.${o.audit.grade}`)}</p>
                  <p className="text-muted">
                    {plural(t, "ov.pagesCrawled", o.audit.pagesCrawled, { n: formatNumber(o.audit.pagesCrawled, lc) })} · {formatRelative(o.audit.finishedAt, lc)}
                  </p>
                  {o.audit.previousScore !== null ? <p className="text-xs text-muted">{t("ov.prevScore", { score: o.audit.previousScore })}</p> : null}
                </div>
              </div>
              <dl className="grid grid-cols-5 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
                {(
                  [
                    ["seo.severity.critical", o.audit.critical, "text-red-600 dark:text-red-400"],
                    ["seo.severity.warning", o.audit.warning, "text-amber-600 dark:text-amber-400"],
                    ["seo.severity.notice", o.audit.notice, "text-muted"],
                    ["ov.newIssues", o.audit.newIssues, "text-ink"],
                    ["ov.fixedIssues", o.audit.fixedIssues, "text-emerald-600 dark:text-emerald-400"],
                  ] as const
                ).map(([key, n, tone]) => (
                  <div key={key} className="min-w-0 bg-surface px-1 py-2.5 sm:px-2">
                    <dt className="truncate text-[11px] text-muted">{t(key)}</dt>
                    <dd className={cn("text-lg font-semibold tabular-nums", tone)}>
                      <Num value={n} locale={lc} />
                    </dd>
                  </div>
                ))}
              </dl>
              {o.audit.topIssues.length ? (
                <ul className="space-y-1.5 text-sm">
                  {o.audit.topIssues.slice(0, 5).map((i) => (
                    <li key={`${i.code}-${i.severity}`} className="flex items-center gap-2">
                      <span className={cn("size-2 shrink-0 rounded-full", i.severity === "critical" ? "bg-red-500" : i.severity === "warning" ? "bg-amber-500" : "bg-line")} aria-hidden />
                      <span className="sr-only">{t(`seo.severity.${i.severity}`)}</span>
                      <span className="min-w-0 flex-1 truncate">{issueTitle(t, i.code)}</span>
                      <Num value={i.count} locale={lc} className="text-muted" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <Empty icon={<ScanSearch />} title={t("ov.noAuditTitle")} action={<ButtonLink href={`${base}/audit`} size="sm">{t("ov.qa.audit")}</ButtonLink>}>
              {t("ov.noAuditText")}
            </Empty>
          )}
        </Panel>
      </div>

      <Panel
        title={t("ov.alertsTitle")}
        description={t("ov.alertsText")}
        actions={
          <ButtonLink href={`${base}/settings#alerts`} size="sm" variant="ghost">
            <Settings2 aria-hidden />
            {t("ov.alertSettings")}
          </ButtonLink>
        }
        padded={!o.alerts.length}
      >
        {o.alerts.length ? (
          <ul className="divide-y divide-line">
            {o.alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <BellRing className={cn("size-4 shrink-0", a.ok ? "text-primary" : "text-muted")} aria-hidden />
                <span className="min-w-0 flex-1 font-medium">{eventLabel(t, a.event)}</span>
                <span className="hidden text-xs text-muted sm:inline" dir="auto">
                  {a.channel ?? (a.ok ? "" : a.error ?? "")}
                </span>
                {a.ok ? <Badge tone="success">{t("ov.alertSent")}</Badge> : <Badge tone="danger" title={a.error ?? undefined}>{t("ov.alertFailed")}</Badge>}
                <span className="text-end text-xs text-muted sm:w-28">{formatRelative(a.createdAt, lc)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("ov.noAlerts")}</p>
        )}
      </Panel>
    </div>
  );
}
