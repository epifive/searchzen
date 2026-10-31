"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, Check, Download, Plus, Search } from "lucide-react";
import { trackQueryAction } from "@/app/actions/dashboard/gsc";
import { HiddenFields, useRefreshingAction } from "@/components/dashboard/client-kit";
import { LineChart } from "@/components/dashboard/overview-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { normalizeKeyword } from "@/seo/normalize";

export interface GscDayData {
  day: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

export interface GscRowData {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

type Metric = "clicks" | "impressions" | "ctr" | "position";

/** One metric at a time over the period (one axis): clicks, impressions, CTR or average position. */
export function GscChart({ days, locale }: { days: GscDayData[]; locale: string }) {
  const t = useT();
  const [metric, setMetric] = useState<Metric>("clicks");
  const label = t(`gsc.metric.${metric}`);
  return (
    <div className="space-y-4">
      <Segmented
        value={metric}
        onChange={setMetric}
        label={t("gsc.chartMetric")}
        options={(["clicks", "impressions", "ctr", "position"] as const).map((m) => ({ value: m, label: t(`gsc.metric.${m}`) }))}
      />
      <LineChart
        points={days.map((d) => ({ day: d.day, value: metric === "position" ? (d.impressions > 0 ? d.position : null) : d[metric] }))}
        format={metric === "ctr" ? "percent" : metric === "position" ? "position" : "number"}
        invert={metric === "position"}
        locale={locale}
        label={label}
        height={220}
        emptyText={t("gsc.noData")}
      />
    </div>
  );
}

type SortKey = "key" | "clicks" | "impressions" | "ctr" | "position";

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s;
}

/** Top queries / pages with search, sorting, CSV export and "track this query". */
export function GscTables({
  projectId,
  queries,
  pages,
  tracked,
  locale,
  canTrack,
  fileBase,
}: {
  projectId: number;
  queries: GscRowData[];
  pages: GscRowData[];
  /** Normalised phrases already tracked in the project. */
  tracked: string[];
  locale: string;
  canTrack: boolean;
  fileBase: string;
}) {
  const t = useT();
  const [tab, setTab] = useState<"queries" | "pages">("queries");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "clicks", desc: true });
  const [limit, setLimit] = useState(25);
  const [state, trackAction, pending] = useRefreshingAction(trackQueryAction);
  const trackedSet = useMemo(() => new Set(tracked), [tracked]);
  const source = tab === "queries" ? queries : pages;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? source.filter((r) => r.key.toLowerCase().includes(q)) : [...source];
    const dir = sort.desc ? -1 : 1;
    list.sort((a, b) => {
      if (sort.key === "key") return a.key.localeCompare(b.key) * dir;
      const av = a[sort.key] ?? Number.MAX_SAFE_INTEGER;
      const bv = b[sort.key] ?? Number.MAX_SAFE_INTEGER;
      return (av - bv) * dir || b.clicks - a.clicks;
    });
    return list;
  }, [source, search, sort]);
  const num = (n: number) => n.toLocaleString(locale);
  const pct = (n: number) => `${(n * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
  const pos = (n: number | null) => (n === null ? "–" : n.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

  const exportCsv = () => {
    const head = [tab === "queries" ? "query" : "page", "clicks", "impressions", "ctr", "position"];
    const body = rows.map((r) => [r.key, r.clicks, r.impressions, Math.round(r.ctr * 10000) / 10000, r.position === null ? "" : r.position].map(csvCell).join(","));
    const blob = new Blob([`${String.fromCharCode(0xfeff)}${[head.join(","), ...body].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBase}-${tab}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const header = (key: SortKey, label: string, end = true) => (
    <th scope="col" className={cn("border-b border-line bg-paper px-3 py-2.5 text-xs font-medium whitespace-nowrap text-muted first:ps-5 last:pe-5", end ? "text-end" : "text-start")} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "key" && key !== "position" }))}
        className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === key && "text-ink")}
      >
        {label}
        <ArrowDownUp className="size-3" aria-hidden />
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <Segmented
          value={tab}
          onChange={(v) => {
            setTab(v);
            setLimit(25);
          }}
          label={t("gsc.tables")}
          options={[
            { value: "queries", label: `${t("gsc.queries")} (${num(queries.length)})` },
            { value: "pages", label: `${t("gsc.pages")} (${num(pages.length)})` },
          ]}
        />
        <div className="relative order-last w-full min-w-0 sm:order-none sm:w-auto sm:max-w-64 sm:flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("gsc.search")} aria-label={t("gsc.search")} className="h-9 ps-9" dir="auto" />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length} className="ms-auto">
          <Download aria-hidden />
          {t("gsc.csv")}
        </Button>
      </div>
      {state.error || state.success ? (
        <p role={state.error ? "alert" : "status"} className={cn("px-5 pt-3 text-sm", state.error ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>
          {state.error ?? state.success}
        </p>
      ) : null}
      {rows.length ? (
        <div className="overflow-x-auto" role="region" aria-label={tab === "queries" ? t("gsc.queries") : t("gsc.pages")} tabIndex={0}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                {header("key", tab === "queries" ? t("gsc.col.query") : t("gsc.col.page"), false)}
                {header("clicks", t("gsc.metric.clicks"))}
                {header("impressions", t("gsc.metric.impressions"))}
                {header("ctr", t("gsc.metric.ctr"))}
                {header("position", t("gsc.metric.position"))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => {
                const isTracked = tab === "queries" && trackedSet.has(normalizeKeyword(r.key));
                return (
                  <tr key={r.key} className="hover:bg-paper/60">
                    <td className="w-1/2 max-w-0 border-b border-line px-3 py-2.5 ps-5">
                      <div className="flex min-w-0 items-center gap-2">
                        {tab === "queries" ? (
                          <span dir="auto" className="min-w-0 truncate font-medium" title={r.key}>
                            {r.key}
                          </span>
                        ) : (
                          <a href={r.key} target="_blank" rel="noopener noreferrer" dir="ltr" className="min-w-0 truncate hover:text-primary" title={r.key}>
                            {r.key.replace(/^https?:\/\//, "")}
                          </a>
                        )}
                        {isTracked ? (
                          <Badge tone="primary" className="shrink-0">
                            <Check className="size-3" aria-hidden />
                            {t("gsc.trackedBadge")}
                          </Badge>
                        ) : tab === "queries" && canTrack ? (
                          <form action={trackAction} className="shrink-0">
                            <HiddenFields fields={{ project_id: projectId, query: r.key }} />
                            <button type="submit" disabled={pending} className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-primary-soft hover:text-primary disabled:opacity-50" title={t("gsc.track")}>
                              <Plus className="size-3" aria-hidden />
                              {t("gsc.track")}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-end tabular-nums">{num(r.clicks)}</td>
                    <td className="border-b border-line px-3 py-2.5 text-end tabular-nums">{num(r.impressions)}</td>
                    <td className="border-b border-line px-3 py-2.5 text-end tabular-nums">{pct(r.ctr)}</td>
                    <td className="border-b border-line px-3 py-2.5 pe-5 text-end tabular-nums">{pos(r.position)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-5 py-10 text-center text-sm text-muted">{search ? t("gsc.noMatch") : t("gsc.noData")}</p>
      )}
      {rows.length > limit ? (
        <div className="flex justify-center p-4">
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 100)}>
            {t("gsc.more", { n: num(rows.length - limit) })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
