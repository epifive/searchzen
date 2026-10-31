import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, CircleAlert, Download, KeyRound, Plus } from "lucide-react";
import { SelectAll } from "@/components/dashboard/client-kit";
import { Kpi, KpiGrid, Num } from "@/components/dashboard/kit";
import { RankChart } from "@/components/dashboard/rank-chart";
import { AddKeywordsForm, KeywordBulkBar } from "@/components/dashboard/rank-forms";
import { Change, FeatureIcons, KeywordChips, Position, Sparkline, TagChips, UrlText } from "@/components/dashboard/rank-kit";
import { featureLabels, parsePeriod, RankNav } from "@/components/dashboard/rank-nav";
import { RankNotices } from "@/components/dashboard/rank-notices";
import { DTable, DTd, DTh, Empty, Pager, Panel } from "@/components/dashboard/ui";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { formatNumber } from "@/lib/dash-format";
import { requireProject } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/messages";
import { countUserKeywords, getProjectTags, listProjectKeywords, type KeywordRecord } from "@/lib/keywords";
import { atLimit, getEntitlements } from "@/lib/plans";
import { getKeywordTrends, getRankSummary, type KeywordTrend } from "@/lib/rank/queries";
import { PAUSE_AFTER_FAILURES } from "@/lib/rank/check";
import { getRankStatus } from "@/lib/rank/status";
import { cn } from "@/lib/utils";
import { countryOptions, formatAveragePosition, languageOptions } from "@/seo/format";

type Search = { period?: string; q?: string; tag?: string; status?: string; sort?: string; dir?: string; page?: string };
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Search> };

const PAGE_SIZE = 50;
const SORTS = ["phrase", "position", "c1", "c7", "c30", "best", "created"] as const;
type Sort = (typeof SORTS)[number];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("dash.nav.rankings")}` };
}

function sortKeywords(list: KeywordRecord[], trends: Map<number, KeywordTrend>, sort: Sort, desc: boolean): KeywordRecord[] {
  const pos = (p: number | null) => (p === null ? Number.MAX_SAFE_INTEGER : p);
  const delta = (k: KeywordRecord, key: "d1" | "d7" | "d30") => trends.get(k.id)?.[key]?.delta ?? null;
  const cmp = (a: KeywordRecord, b: KeywordRecord): number => {
    switch (sort) {
      case "position":
        return pos(a.lastCheckedAt ? a.lastPosition : null) - pos(b.lastCheckedAt ? b.lastPosition : null);
      case "best":
        return pos(a.bestPosition) - pos(b.bestPosition);
      case "created":
        return b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
      case "c1":
      case "c7":
      case "c30": {
        const key = sort === "c1" ? "d1" : sort === "c7" ? "d7" : "d30";
        const x = delta(a, key);
        const y = delta(b, key);
        if (x === null && y === null) return 0;
        if (x === null) return desc ? -1 : 1;
        if (y === null) return desc ? 1 : -1;
        return y - x;
      }
      default:
        return 0;
    }
  };
  return [...list].sort((a, b) => (desc ? -1 : 1) * cmp(a, b) || a.phrase.localeCompare(b.phrase) || a.id - b.id);
}

export default async function RankingsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const [{ user, project }, t, locale, query] = await Promise.all([requireProject(id), getT(), getLocale(), searchParams]);
  const lc = locale.code;
  const period = parsePeriod(query.period);
  const status = query.status === "paused" || query.status === "all" ? query.status : "active";
  const sort: Sort = (SORTS as readonly string[]).includes(query.sort ?? "") ? (query.sort as Sort) : "position";
  const desc = query.dir === "desc";
  const search = (query.q ?? "").slice(0, 100);
  const tag = (query.tag ?? "").slice(0, 40);

  const [rankStatus, entitlements, used, summary, tags, { keywords: filtered, total: totalFiltered }] = await Promise.all([
    getRankStatus(),
    getEntitlements(user),
    countUserKeywords(user.id),
    getRankSummary(project.id, period),
    getProjectTags(project.id),
    listProjectKeywords(project.id, { status: status === "all" ? undefined : status, tag, search, limit: 5000 }),
  ]);
  const trends = await getKeywordTrends(filtered);
  const sorted = sortKeywords(filtered, trends, sort, desc);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(query.page) || 1));
  const rows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const base = `/dashboard/projects/${project.id}/rankings`;
  const href = (o: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged: Search = { period: String(period), q: search, tag, status, sort, dir: desc ? "desc" : "", ...o };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "status" && v === "active") && !(k === "page" && v === "1")) p.set(k, String(v));
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  const exportHref = `${base}/export?${new URLSearchParams({ status, ...(tag ? { tag } : {}), ...(search ? { q: search } : {}) }).toString()}`;
  const atKeywordLimit = atLimit(used, entitlements.maxKeywords);
  const labels = { new: t("seo.new"), lost: t("seo.lost") };
  const fLabels = featureLabels(t);
  const isAdmin = user.role === "admin";
  const settings = project.settings;
  const hasKeywords = summary.keywords > 0;

  const addPanel = (
    <Panel
      id="add-keywords"
      title={t("rank.add.title")}
      description={
        entitlements.maxKeywords > 0
          ? t("rank.add.usage", { used: formatNumber(used, lc), limit: formatNumber(entitlements.maxKeywords, lc) })
          : t("rank.add.usageUnlimited", { used: formatNumber(used, lc) })
      }
    >
      {atKeywordLimit ? (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {t("rank.add.limitReached")}{" "}
          <Link href="/pricing" className="font-medium underline underline-offset-2">
            {t("rank.add.upgrade")}
          </Link>
        </p>
      ) : null}
      <AddKeywordsForm
        projectId={project.id}
        domain={project.domain}
        countries={countryOptions(lc)}
        languages={languageOptions(lc)}
        defaults={{ country: settings.country, language: settings.language, device: settings.device, location: settings.location }}
        disabled={atKeywordLimit}
        deviceNote={rankStatus.supportsDevice ? undefined : t("rank.add.deviceIgnored", { provider: rankStatus.providerName })}
        locationNote={rankStatus.supportsLocation ? undefined : t("rank.add.locationIgnored", { provider: rankStatus.providerName })}
      />
    </Panel>
  );

  const avgDelta = summary.previous.averagePosition !== null && summary.averagePosition !== null ? Math.round((summary.previous.averagePosition - summary.averagePosition) * 10) / 10 : null;
  const visDelta = summary.previous.visibility !== null ? Math.round((summary.visibility - summary.previous.visibility) * 10) / 10 : null;
  const deltaNode = (v: number | null, title: string) =>
    v === null || v === 0 ? null : (
      <span title={title} className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums", v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
        {v > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
        <bdi>{formatNumber(Math.abs(v), lc, { maximumFractionDigits: 1 })}</bdi>
        <span className="sr-only">{title}</span>
      </span>
    );
  const sortHeader = (key: Sort, label: string, className?: string) => {
    const activeSort = sort === key;
    const nextDesc = activeSort ? !desc : key === "c1" || key === "c7" || key === "c30";
    return (
      <DTh className={className}>
        <Link href={href({ sort: key, dir: nextDesc ? "desc" : "", page: "1" })} scroll={false} className={cn("inline-flex items-center gap-1 hover:text-ink", activeSort && "text-ink")} aria-sort={activeSort ? (desc ? "descending" : "ascending") : undefined}>
          {label}
          {activeSort ? desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden /> : null}
        </Link>
      </DTh>
    );
  };

  return (
    <div className="space-y-6">
      <RankNotices status={rankStatus} isAdmin={isAdmin} t={t} locale={lc} />
      <RankNav projectId={project.id} active="keywords" period={period} t={t} />

      {!hasKeywords ? (
        <>
          <Panel>
            <Empty icon={<KeyRound />} title={t("rank.empty.title")}>
              {t("rank.empty.text")}
            </Empty>
          </Panel>
          {addPanel}
        </>
      ) : (
        <>
          <KpiGrid className="grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
            <Kpi label={t("rank.kpi.tracked")} value={<Num value={summary.active} locale={lc} />} hint={summary.active !== summary.keywords ? plural(t, "rank.kpi.pausedCount", summary.keywords - summary.active) : undefined} />
            <Kpi label={t("rank.kpi.avgPosition")} value={<bdi>{formatAveragePosition(summary.averagePosition, lc)}</bdi>} delta={deltaNode(avgDelta, t("rank.kpi.vsStart", { n: period }))} />
            <Kpi label={t("rank.kpi.visibility")} value={<bdi>{formatNumber(summary.visibility, lc, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</bdi>} delta={deltaNode(visDelta, t("rank.kpi.vsStart", { n: period }))} />
            <Kpi label={t("rank.kpi.top3")} value={<Num value={summary.top3} locale={lc} />} />
            <Kpi label={t("rank.kpi.top10")} value={<Num value={summary.top10} locale={lc} />} />
            <Kpi label={t("rank.kpi.top100")} value={<Num value={summary.top100} locale={lc} />} />
            <Kpi label={t("rank.kpi.up")} accent="bg-emerald-500" value={<Num value={summary.up} locale={lc} />} hint={t("rank.kpi.sinceDays", { n: period })} />
            <Kpi label={t("rank.kpi.down")} accent="bg-red-500" value={<Num value={summary.down} locale={lc} />} hint={t("rank.kpi.sinceDays", { n: period })} />
          </KpiGrid>

          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel title={t("rank.chart.visibility")} description={t("rank.chart.visibilityHint")}>
              <RankChart
                days={summary.series.map((p) => p.day)}
                series={[{ id: "vis", label: t("rank.kpi.visibility"), color: 0, values: summary.series.map((p) => p.visibility) }]}
                kind="score"
                locale={lc}
                label={t("rank.chart.visibility")}
                tableLabel={t("rank.chart.table")}
                dayLabel={t("rank.col.day")}
                emptyText={t("rank.chart.empty")}
              />
            </Panel>
            <Panel title={t("rank.chart.avgPosition")} description={t("rank.chart.avgPositionHint")}>
              <RankChart
                days={summary.series.map((p) => p.day)}
                series={[{ id: "avg", label: t("rank.kpi.avgPosition"), color: 0, values: summary.series.map((p) => p.averagePosition) }]}
                kind="position"
                invert
                locale={lc}
                label={t("rank.chart.avgPosition")}
                tableLabel={t("rank.chart.table")}
                dayLabel={t("rank.col.day")}
                emptyText={t("rank.chart.empty")}
              />
            </Panel>
          </div>

          <Panel
            padded={false}
            title={t("rank.table.title")}
            description={plural(t, "rank.table.count", totalFiltered, { n: formatNumber(totalFiltered, lc) })}
            actions={
              <>
                <a href={exportHref} className={buttonClass("outline", "sm")} download>
                  <Download aria-hidden />
                  {t("rank.table.export")}
                </a>
                <ButtonLink href="#add-keywords" size="sm" variant="secondary">
                  <Plus aria-hidden />
                  {t("rank.add.title")}
                </ButtonLink>
              </>
            }
          >
            <form method="get" action={base} className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3">
              <input type="hidden" name="period" value={period} />
              <input type="hidden" name="sort" value={sort} />
              {desc ? <input type="hidden" name="dir" value="desc" /> : null}
              <label className="min-w-0 flex-1 basis-48">
                <span className="sr-only">{t("rank.filter.search")}</span>
                <Input name="q" type="search" defaultValue={search} dir="auto" placeholder={t("rank.filter.search")} className="h-9" />
              </label>
              {tags.length ? (
                <label>
                  <span className="sr-only">{t("rank.filter.tag")}</span>
                  <Select name="tag" defaultValue={tag} className="h-9 w-auto max-w-44">
                    <option value="">{t("rank.filter.allTags")}</option>
                    {tags.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
              <label>
                <span className="sr-only">{t("rank.filter.status")}</span>
                <Select name="status" defaultValue={status} className="h-9 w-auto">
                  <option value="active">{t("rank.filter.active")}</option>
                  <option value="paused">{t("rank.filter.paused")}</option>
                  <option value="all">{t("rank.filter.all")}</option>
                </Select>
              </label>
              <button type="submit" className={buttonClass("outline", "sm", "h-9")}>
                {t("rank.filter.apply")}
              </button>
            </form>
            <div className="border-b border-line px-5 py-2.5">
              <KeywordBulkBar formId="kw-bulk" projectId={project.id} canCheck={rankStatus.ready} />
            </div>
            {rows.length ? (
              <DTable minWidth={760} dense label={t("rank.table.title")}>
                <thead>
                  <tr>
                    <DTh className="w-8">
                      <SelectAll form="kw-bulk" label={t("rank.table.selectAll")} />
                    </DTh>
                    {sortHeader("phrase", t("rank.col.keyword"))}
                    {sortHeader("position", t("rank.col.position"), "text-end")}
                    {sortHeader("c1", t("rank.col.d1"), "hidden text-end xl:table-cell")}
                    {sortHeader("c7", t("rank.col.d7"), "text-end")}
                    {sortHeader("c30", t("rank.col.d30"), "text-end")}
                    {sortHeader("best", t("rank.col.best"), "hidden text-end xl:table-cell")}
                    <DTh>{t("rank.col.url")}</DTh>
                    <DTh className="hidden lg:table-cell">{t("rank.col.features")}</DTh>
                    <DTh>{t("rank.col.trend")}</DTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((k) => {
                    const tr = trends.get(k.id);
                    const checked = Boolean(k.lastCheckedAt);
                    return (
                      <tr key={k.id} className="hover:bg-paper/60">
                        <DTd>
                          <input type="checkbox" name="ids" value={k.id} form="kw-bulk" aria-label={t("rank.table.select", { keyword: k.phrase })} className="size-4 rounded border-line accent-[var(--primary)]" />
                        </DTd>
                        <DTd>
                          <Link href={`${base}/${k.id}?period=${period}`} title={k.phrase} className="block max-w-52 truncate font-medium hover:text-primary 2xl:max-w-72">
                            <bdi dir="auto">{k.phrase}</bdi>
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <KeywordChips country={k.country} device={k.device} location={k.location} deviceLabel={t(`dash.device.${k.device}`)} />
                            <TagChips tags={k.tags} />
                            {k.status === "paused" && k.lastError && k.failCount >= PAUSE_AFTER_FAILURES ? (
                              <Badge tone="danger" title={k.lastError}>
                                <CircleAlert className="size-3" aria-hidden />
                                {t("rank.kw.failedPaused")}
                                <span className="sr-only">{k.lastError}</span>
                              </Badge>
                            ) : k.status === "paused" ? (
                              <Badge>{t("dash.projects.paused")}</Badge>
                            ) : null}
                            {k.device === "mobile" && !rankStatus.supportsDevice ? (
                              <Badge tone="warning" title={t("rank.kw.desktopOnly", { provider: rankStatus.providerName })}>
                                {t("rank.kw.desktopResults")}
                                <span className="sr-only">{t("rank.kw.desktopOnly", { provider: rankStatus.providerName })}</span>
                              </Badge>
                            ) : null}
                            {k.status !== "paused" && k.lastError && k.failCount > 0 ? (
                              <span title={k.lastError} className="inline-flex text-amber-600 dark:text-amber-400">
                                <CircleAlert className="size-3.5" aria-hidden />
                                <span className="sr-only">{k.lastError}</span>
                              </span>
                            ) : null}
                          </div>
                        </DTd>
                        <DTd className="text-end text-base">{checked ? <Position position={k.lastPosition} depth={rankStatus.depth} locale={lc} /> : <Badge tone="neutral">{t("rank.pending")}</Badge>}</DTd>
                        <DTd className="hidden text-end xl:table-cell">
                          <Change change={tr?.d1} labels={labels} />
                        </DTd>
                        <DTd className="text-end">
                          <Change change={tr?.d7} labels={labels} />
                        </DTd>
                        <DTd className="text-end">
                          <Change change={tr?.d30} labels={labels} />
                        </DTd>
                        <DTd className="hidden text-end xl:table-cell">
                          <Position position={k.bestPosition} locale={lc} className="font-normal" />
                        </DTd>
                        <DTd>
                          <UrlText url={k.lastUrl} domain={project.domain} className="max-w-36 xl:max-w-44 2xl:max-w-56" />
                        </DTd>
                        <DTd className="hidden lg:table-cell">
                          <FeatureIcons features={k.lastFeatures} labels={fLabels} className="max-w-24" />
                        </DTd>
                        <DTd>
                          <Sparkline points={(tr?.spark ?? []).map((p) => p.position)} label={t("rank.col.trendLabel", { keyword: k.phrase })} width={64} height={22} />
                        </DTd>
                      </tr>
                    );
                  })}
                </tbody>
              </DTable>
            ) : (
              <Empty title={t("rank.table.noMatch")}>{t("rank.table.noMatchText")}</Empty>
            )}
            <Pager
              page={page}
              pages={pages}
              href={(p) => href({ page: String(p) })}
              labels={{ summary: t("rank.table.page", { page, pages }), previous: t("dash.pager.previous"), next: t("dash.pager.next"), nav: t("dash.pager.label") }}
            />
          </Panel>
          {addPanel}
        </>
      )}
    </div>
  );
}
