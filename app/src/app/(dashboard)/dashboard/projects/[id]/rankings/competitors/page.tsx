import type { Metadata } from "next";
import { Swords } from "lucide-react";
import { RankChart } from "@/components/dashboard/rank-chart";
import { SERIES_COLORS, SeriesKey } from "@/components/dashboard/rank-kit";
import { parsePeriod, RankNav } from "@/components/dashboard/rank-nav";
import { RankNotices } from "@/components/dashboard/rank-notices";
import { DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { ButtonLink } from "@/components/ui/button";
import { formatNumber } from "@/lib/dash-format";
import { requireProject } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { getCompetitorOverview } from "@/lib/rank/queries";
import { getRankStatus } from "@/lib/rank/status";
import { cn } from "@/lib/utils";
import { formatAveragePosition } from "@/seo/format";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("rank.nav.competitors")}` };
}

/** Share of voice, visibility and positions of the project against its competitor domains. */
export default async function CompetitorsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const [{ user, project }, t, locale, query] = await Promise.all([requireProject(id), getT(), getLocale(), searchParams]);
  const lc = locale.code;
  const period = parsePeriod(query.period);
  const competitors = project.settings.competitors;
  const [status, overview] = await Promise.all([getRankStatus(), getCompetitorOverview({ id: project.id, domain: project.domain, competitors }, period)]);
  const pct = (v: number) => `${formatNumber(v, lc, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const maxShare = Math.max(1, ...overview.domains.map((d) => d.share));

  return (
    <div className="space-y-6">
      <RankNotices status={status} isAdmin={user.role === "admin"} t={t} locale={lc} />
      <RankNav projectId={project.id} active="competitors" period={period} t={t} />
      {!competitors.length ? (
        <Panel>
          <Empty
            icon={<Swords />}
            title={t("rank.comp.emptyTitle")}
            action={
              <ButtonLink href={`/dashboard/projects/${project.id}/settings`} size="sm">
                {t("rank.comp.addCompetitors")}
              </ButtonLink>
            }
          >
            {t("rank.comp.emptyText")}
          </Empty>
        </Panel>
      ) : !overview.keywords ? (
        <Panel>
          <Empty icon={<Swords />} title={t("rank.comp.noDataTitle")}>
            {t("rank.comp.noDataText")}
          </Empty>
        </Panel>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Panel title={t("rank.comp.share")} description={t("rank.comp.shareHint", { n: overview.keywords })}>
              <ul className="space-y-3">
                {overview.domains.map((d, i) => (
                  <li key={d.domain}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <SeriesKey index={i}>
                        <bdi dir="ltr" className={cn("truncate", d.isProject && "font-semibold")}>
                          {d.domain}
                        </bdi>
                      </SeriesKey>
                      <span className="font-semibold tabular-nums">{pct(d.share)}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line/60">
                      <div className={cn("h-full rounded-full", SERIES_COLORS[i % SERIES_COLORS.length].bg)} style={{ width: `${Math.max(d.share > 0 ? 1.5 : 0, (d.share / maxShare) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={t("rank.comp.visibility")} description={t("rank.chart.visibilityHint")}>
              <RankChart
                days={overview.series.map((p) => p.day)}
                series={overview.domains.map((d, i) => ({ id: d.domain, label: d.domain, color: i, values: overview.series.map((p) => p.values[d.domain] ?? null) }))}
                kind="score"
                locale={lc}
                label={t("rank.comp.visibility")}
                tableLabel={t("rank.chart.table")}
                dayLabel={t("rank.col.day")}
                emptyText={t("rank.chart.empty")}
              />
            </Panel>
          </div>
          <Panel padded={false} title={t("rank.comp.table")} description={t("rank.comp.tableHint")}>
            <DTable minWidth={760} label={t("rank.comp.table")}>
              <thead>
                <tr>
                  <DTh>{t("rank.col.domain")}</DTh>
                  <DTh className="text-end">{t("rank.comp.shareCol")}</DTh>
                  <DTh className="text-end">{t("rank.kpi.visibility")}</DTh>
                  <DTh className="text-end">{t("rank.kpi.avgPosition")}</DTh>
                  <DTh className="text-end">{t("rank.kpi.top3")}</DTh>
                  <DTh className="text-end">{t("rank.kpi.top10")}</DTh>
                  <DTh className="text-end">{t("rank.comp.ranked")}</DTh>
                  <DTh className="text-end">{t("rank.col.ahead")}</DTh>
                </tr>
              </thead>
              <tbody>
                {overview.domains.map((d, i) => (
                  <tr key={d.domain} className={cn(d.isProject && "bg-primary-soft/60")}>
                    <DTd>
                      <SeriesKey index={i}>
                        <bdi dir="ltr" className={cn(d.isProject && "font-semibold")}>
                          {d.domain}
                        </bdi>
                      </SeriesKey>
                    </DTd>
                    <DTd className="text-end tabular-nums">{pct(d.share)}</DTd>
                    <DTd className="text-end tabular-nums">{pct(d.visibility)}</DTd>
                    <DTd className="text-end tabular-nums">{formatAveragePosition(d.averagePosition, lc)}</DTd>
                    <DTd className="text-end tabular-nums">{formatNumber(d.top3, lc)}</DTd>
                    <DTd className="text-end tabular-nums">{formatNumber(d.top10, lc)}</DTd>
                    <DTd className="text-end tabular-nums">{`${formatNumber(d.ranked, lc)}/${formatNumber(overview.keywords, lc)}`}</DTd>
                    <DTd className="text-end tabular-nums">{d.isProject ? "–" : formatNumber(d.ahead, lc)}</DTd>
                  </tr>
                ))}
              </tbody>
            </DTable>
          </Panel>
        </>
      )}
    </div>
  );
}
