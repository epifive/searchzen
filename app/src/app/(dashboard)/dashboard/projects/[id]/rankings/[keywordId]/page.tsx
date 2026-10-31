import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pause, Play, RefreshCw } from "lucide-react";
import { bulkKeywordsAction } from "@/app/actions/dashboard/keywords";
import { ActionButton } from "@/components/dashboard/actions";
import { Kpi, KpiGrid } from "@/components/dashboard/kit";
import { RankChart } from "@/components/dashboard/rank-chart";
import { KeywordEditForm } from "@/components/dashboard/rank-forms";
import { Change, FEATURE_ICONS, FeatureIcons, KeywordChips, Position, SeriesKey, TagChips, UrlText, SERIES_COLORS } from "@/components/dashboard/rank-kit";
import { featureLabels, parsePeriod, RANK_PERIODS } from "@/components/dashboard/rank-nav";
import { RankNotices } from "@/components/dashboard/rank-notices";
import { DTable, DTd, DTh, Empty, LinkTabs, Panel } from "@/components/dashboard/ui";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatDay } from "@/lib/dash-format";
import { requireProject } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { getProjectKeyword } from "@/lib/keywords";
import { getKeywordHistoryRows, getLatestSnapshot } from "@/lib/rank/queries";
import { getRankStatus } from "@/lib/rank/status";
import { cn } from "@/lib/utils";
import { averagePosition, hostMatches, positionChange } from "@/seo/normalize";
import { SERP_FEATURES } from "@/seo/types";
import { formatAveragePosition, localCountryName } from "@/seo/format";

type Props = { params: Promise<{ id: string; keywordId: string }>; searchParams: Promise<{ period?: string }> };

async function load(params: Props["params"]) {
  const { id, keywordId } = await params;
  const { user, project } = await requireProject(id);
  const keyword = /^\d{1,10}$/.test(keywordId) ? await getProjectKeyword(project.id, Number(keywordId)) : undefined;
  if (!keyword) notFound();
  return { user, project, keyword };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ project, keyword }, t] = await Promise.all([load(params), getT()]);
  return { title: `${keyword.phrase} · ${t("dash.nav.rankings")} · ${project.name}` };
}

export default async function KeywordPage({ params, searchParams }: Props) {
  const [{ user, project, keyword }, t, locale, query] = await Promise.all([load(params), getT(), getLocale(), searchParams]);
  const lc = locale.code;
  const period = parsePeriod(query.period);
  const [history, snapshot, status] = await Promise.all([getKeywordHistoryRows(keyword.id, period), getLatestSnapshot(keyword.id), getRankStatus()]);
  const base = `/dashboard/projects/${project.id}/rankings`;
  const labels = { new: t("seo.new"), lost: t("seo.lost") };
  const fLabels = featureLabels(t);
  const competitors = project.settings.competitors;
  const domains = [project.domain, ...competitors];
  const days = history.map((h) => h.day);
  const positions = history.map((h) => h.position);
  const first = history[0];
  const periodChange = first && keyword.lastCheckedAt ? positionChange(first.position, keyword.lastPosition) : null;
  const rankedInPeriod = positions.filter((p): p is number => p !== null);

  // URL changes: a check where another page ranks than at the last check that ranked.
  const urlChanges: Array<{ day: string; from: string | null; to: string | null }> = [];
  let lastUrl: string | null = null;
  for (const h of history) {
    if (!h.url) continue;
    if (lastUrl && lastUrl !== h.url) urlChanges.push({ day: h.day, from: lastUrl, to: h.url });
    lastUrl = h.url;
  }
  const comp = domains.map((d, i) => {
    const values = history.map((h) => (i === 0 ? h.position : (h.competitors[d] ?? null)));
    const ranked = values.filter((v): v is number => v !== null);
    const latest = history.length ? values[values.length - 1] : null;
    return {
      domain: d,
      color: i,
      values,
      latest,
      best: ranked.length ? Math.min(...ranked) : null,
      average: averagePosition(values),
      ahead: i === 0 ? null : history.filter((h) => (h.competitors[d] ?? null) !== null && (h.position === null || (h.competitors[d] as number) < h.position)).length,
    };
  });
  const domainIndex = (domain: string) => domains.findIndex((d) => hostMatches(domain, d));

  return (
    <div className="space-y-6">
      <RankNotices status={status} isAdmin={user.role === "admin"} t={t} locale={lc} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`${base}?period=${period}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
            {t("rank.detail.back")}
          </Link>
          <h2 className="mt-2 text-xl font-bold break-words">
            <bdi dir="auto">{keyword.phrase}</bdi>
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <KeywordChips country={keyword.country} device={keyword.device} location={keyword.location} deviceLabel={t(`dash.device.${keyword.device}`)} />
            <span className="text-xs text-muted">{localCountryName(keyword.country, lc)}</span>
            <TagChips tags={keyword.tags} />
            {keyword.status === "paused" ? <Badge>{t("dash.projects.paused")}</Badge> : null}
            {keyword.device === "mobile" && !status.supportsDevice ? (
              <Badge tone="warning" title={t("rank.kw.desktopOnly", { provider: status.providerName })}>
                {t("rank.kw.desktopResults")}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {status.ready && keyword.status === "active" ? (
            <ActionButton action={bulkKeywordsAction} fields={{ project_id: project.id, op: "check", ids: keyword.id }} showSuccess>
              <RefreshCw aria-hidden />
              {t("rank.bulk.check")}
            </ActionButton>
          ) : null}
          <ActionButton action={bulkKeywordsAction} fields={{ project_id: project.id, op: keyword.status === "active" ? "pause" : "resume", ids: keyword.id }}>
            {keyword.status === "active" ? <Pause aria-hidden /> : <Play aria-hidden />}
            {keyword.status === "active" ? t("rank.bulk.pause") : t("rank.bulk.resume")}
          </ActionButton>
        </div>
      </div>

      <LinkTabs
        label={t("rank.period.label")}
        items={RANK_PERIODS.map((p) => ({ href: `${base}/${keyword.id}?period=${p}`, label: t("rank.period.days", { n: p }), active: p === period }))}
      />

      <KpiGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label={t("rank.col.position")}
          value={keyword.lastCheckedAt ? <Position position={keyword.lastPosition} depth={status.depth} locale={lc} /> : t("rank.pending")}
          delta={periodChange && periodChange.kind !== "same" ? <Change change={periodChange} labels={labels} /> : null}
        />
        <Kpi label={t("rank.col.best")} value={<Position position={keyword.bestPosition} locale={lc} />} />
        <Kpi label={t("rank.detail.start")} value={<Position position={keyword.startPosition} locale={lc} />} />
        <Kpi label={t("rank.detail.average", { n: period })} value={<bdi>{formatAveragePosition(averagePosition(positions), lc)}</bdi>} />
        <Kpi label={t("rank.detail.rankedDays")} value={<bdi className="tabular-nums">{`${rankedInPeriod.length}/${history.length}`}</bdi>} />
        <Kpi label={t("rank.detail.lastChecked")} value={<span className="block text-sm whitespace-normal">{keyword.lastCheckedAt ? formatDateTime(keyword.lastCheckedAt, lc) : "–"}</span>} />
      </KpiGrid>
      {keyword.lastError && keyword.failCount > 0 ? <p className="text-sm text-amber-700 dark:text-amber-400">{t("rank.detail.lastError", { error: keyword.lastError })}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] [&>*]:min-w-0">
        <Panel title={t("rank.detail.history")} description={t("rank.detail.historyHint")}>
          <RankChart
            days={days}
            series={[{ id: "own", label: project.domain, color: 0, values: positions }]}
            kind="position"
            invert
            locale={lc}
            label={t("rank.detail.history")}
            tableLabel={t("rank.chart.table")}
            dayLabel={t("rank.col.day")}
            emptyText={t("rank.chart.empty")}
            height={240}
          />
        </Panel>
        <Panel title={t("rank.detail.settings")}>
          <KeywordEditForm projectId={project.id} keywordId={keyword.id} tags={keyword.tags} targetUrl={keyword.targetUrl} domain={project.domain} />
        </Panel>
      </div>

      {competitors.length ? (
        <Panel title={t("rank.detail.competitors")} description={t("rank.detail.competitorsHint")}>
          <RankChart
            days={days}
            series={comp.map((c) => ({ id: c.domain, label: c.domain, color: c.color, values: c.values }))}
            kind="position"
            invert
            locale={lc}
            label={t("rank.detail.competitors")}
            tableLabel={t("rank.chart.table")}
            dayLabel={t("rank.col.day")}
            emptyText={t("rank.chart.empty")}
          />
          <div className="-mx-5 mt-4 border-t border-line">
            <DTable minWidth={560} label={t("rank.detail.competitors")}>
              <thead>
                <tr>
                  <DTh>{t("rank.col.domain")}</DTh>
                  <DTh className="text-end">{t("rank.col.position")}</DTh>
                  <DTh className="text-end">{t("rank.col.best")}</DTh>
                  <DTh className="text-end">{t("rank.detail.average", { n: period })}</DTh>
                  <DTh className="text-end">{t("rank.col.ahead")}</DTh>
                </tr>
              </thead>
              <tbody>
                {comp.map((c) => (
                  <tr key={c.domain}>
                    <DTd>
                      <SeriesKey index={c.color}>
                        <bdi dir="ltr" className={cn(c.color === 0 && "font-semibold")}>
                          {c.domain}
                        </bdi>
                      </SeriesKey>
                    </DTd>
                    <DTd className="text-end">
                      <Position position={c.latest} depth={status.depth} locale={lc} />
                    </DTd>
                    <DTd className="text-end">
                      <Position position={c.best} locale={lc} />
                    </DTd>
                    <DTd className="text-end tabular-nums">{formatAveragePosition(c.average, lc)}</DTd>
                    <DTd className="text-end tabular-nums">{c.ahead === null ? "–" : `${c.ahead}/${history.length}`}</DTd>
                  </tr>
                ))}
              </tbody>
            </DTable>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel padded={false} title={t("rank.detail.snapshot")} description={snapshot ? t("rank.detail.snapshotAt", { time: formatDateTime(snapshot.checkedAt, lc) }) : undefined}>
          {snapshot && snapshot.results.length ? (
            <ol className="divide-y divide-line">
              {snapshot.results.map((r) => {
                const idx = domainIndex(r.domain);
                return (
                  <li key={`${r.position}-${r.url}`} className={cn("flex items-start gap-3 px-5 py-2.5", idx === 0 && "bg-primary-soft")}>
                    <span className={cn("w-6 shrink-0 pt-0.5 text-end text-sm tabular-nums", idx === 0 ? "font-bold text-primary-text" : "text-muted")}>{r.position}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" dir="auto" title={r.title}>
                        {r.title || r.domain}
                      </p>
                      <UrlText url={r.url} className="max-w-full text-xs" />
                    </div>
                    {idx >= 0 ? (
                      <span className="shrink-0 pt-0.5">
                        <span className={cn("inline-block size-2 rounded-full", SERIES_COLORS[idx % SERIES_COLORS.length].bg)} aria-hidden />
                        <span className="sr-only">{idx === 0 ? t("rank.detail.yourSite") : t("rank.detail.competitor")}</span>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <Empty title={t("rank.detail.noSnapshot")}>{t("rank.detail.noSnapshotText")}</Empty>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel title={t("rank.detail.features")} description={t("rank.detail.featuresHint")}>
            {history.length ? (
              <ul className="space-y-2.5">
                {SERP_FEATURES.map((f) => {
                  const Icon = FEATURE_ICONS[f];
                  const count = history.filter((h) => h.features.includes(f)).length;
                  return (
                    <li key={f} className="flex items-center gap-3">
                      <span className={cn("flex w-40 shrink-0 items-center gap-1.5 text-xs", count ? "text-ink" : "text-muted")}>
                        <Icon className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{fLabels[f]}</span>
                      </span>
                      <span className="flex min-w-0 flex-1 gap-px overflow-hidden rounded-sm" aria-label={t("rank.detail.featureDays", { feature: fLabels[f], n: count, total: history.length })} role="img">
                        {history.map((h) => (
                          <span key={h.day} title={`${formatDay(h.day, lc)}`} className={cn("h-3 min-w-0 flex-1", h.features.includes(f) ? "bg-primary" : "bg-line/70")} />
                        ))}
                      </span>
                      <span className="w-10 shrink-0 text-end text-xs text-muted tabular-nums">{count}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("rank.chart.empty")}</p>
            )}
          </Panel>
          <Panel title={t("rank.detail.urlChanges")}>
            {urlChanges.length ? (
              <ul className="space-y-3 text-sm">
                {urlChanges
                  .slice(-12)
                  .reverse()
                  .map((c) => (
                    <li key={c.day} className="min-w-0">
                      <p className="text-xs text-muted">{formatDay(c.day, lc, true)}</p>
                      <div className="mt-0.5 grid gap-0.5">
                        <UrlText url={c.from} domain={project.domain} className="max-w-full line-through decoration-1" />
                        <UrlText url={c.to} domain={project.domain} className="max-w-full text-ink" />
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("rank.detail.noUrlChanges")}</p>
            )}
          </Panel>
        </div>
      </div>

      <Panel padded={false} title={t("rank.detail.daily")}>
        {history.length ? (
          <div className="max-h-[36rem] overflow-y-auto">
          <DTable minWidth={640} label={t("rank.detail.daily")}>
            <thead>
              <tr>
                <DTh>{t("rank.col.day")}</DTh>
                <DTh className="text-end">{t("rank.col.position")}</DTh>
                <DTh className="text-end">{t("rank.col.change")}</DTh>
                <DTh>{t("rank.col.url")}</DTh>
                <DTh>{t("rank.col.features")}</DTh>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((h, i, list) => (
                <tr key={h.day}>
                  <DTd className="whitespace-nowrap">{formatDay(h.day, lc, true)}</DTd>
                  <DTd className="text-end">
                    <Position position={h.position} depth={status.depth} locale={lc} />
                  </DTd>
                  <DTd className="text-end">
                    <Change change={list[i + 1] ? positionChange(list[i + 1].position, h.position) : null} labels={labels} />
                  </DTd>
                  <DTd>
                    <UrlText url={h.url} domain={project.domain} />
                  </DTd>
                  <DTd>
                    <FeatureIcons features={h.features} labels={fLabels} />
                  </DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
          </div>
        ) : (
          <Empty title={t("rank.detail.noHistory")}>{t("rank.detail.noHistoryText")}</Empty>
        )}
      </Panel>
    </div>
  );
}
