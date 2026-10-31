import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ChangeText, issueTitle, PositionText } from "@/components/dashboard/overview-bits";
import { LineChart } from "@/components/dashboard/overview-chart";
import { PrintButton } from "@/components/dashboard/report-print";
import { formatDateTime, formatDay, formatNumber } from "@/lib/dash-format";
import type { Translator } from "@/lib/i18n/messages";
import { interpolateParts, plural } from "@/lib/i18n/messages";
import { REPORT_PERIODS, type ReportData } from "@/lib/reports/data";
import { cn } from "@/lib/utils";
import { formatAveragePosition, scoreTone } from "@/seo/format";

/**
 * The client report (public link, owner preview): print-optimised HTML. "Download PDF" opens
 * the browser's print dialog ("Save as PDF"); @page and print rules below drop the toolbar,
 * force light colours and keep sections together.
 */

const PRINT_CSS = `
@page { size: A4; margin: 14mm 12mm; }
@media print {
  :root, .dark { --paper: #ffffff; --surface: #ffffff; --ink: #111827; --muted: #4b5563; --line: #d9dee7; color-scheme: light; }
  html, body { background: #ffffff !important; }
  .sz-report { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sz-report a { text-decoration: none; }
  .sz-report thead { display: table-header-group; }
  .sz-report tr, .sz-report li { break-inside: avoid; }
}
`;

function Section({ title, children, className, id }: { title: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-xl border border-line bg-surface p-5 sm:p-6 print:rounded-none print:border-0 print:border-t print:px-0 print:py-5", className)}>
      <h2 className="mb-4 font-sans text-base font-semibold tracking-normal" style={{ color: "var(--report-accent)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Figure({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line px-3 py-3 print:break-inside-avoid">
      <p className="truncate text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function ReportView({ data, t, locale, basePath, preview = false }: { data: ReportData; t: Translator; locale: string; basePath: string; preview?: boolean }) {
  const r = data.rankings;
  const lc = locale;
  const pct = (v: number) => `${formatNumber(v, lc, { maximumFractionDigits: 1 })}%`;
  const style = { "--primary": data.brand.color, "--report-accent": data.brand.color } as CSSProperties;
  const signed = (v: number) => (v > 0 ? `+${formatNumber(v, lc, { maximumFractionDigits: 1 })}` : formatNumber(v, lc, { maximumFractionDigits: 1 }));

  return (
    <div className="sz-report mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10 print:max-w-none print:p-0" style={style}>
      <style>{PRINT_CSS}</style>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <nav aria-label={t("rep.view.period")} className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-paper p-1">
          {REPORT_PERIODS.map((p) => (
            <Link
              key={p}
              href={`${basePath}?days=${p}`}
              aria-current={p === data.days ? "page" : undefined}
              scroll={false}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium", p === data.days ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink")}
            >
              {t("ov.lastDays", { n: p })}
            </Link>
          ))}
        </nav>
        <PrintButton label={t("rep.view.pdf")} />
      </div>

      {preview ? <p className="mb-4 rounded-lg border border-dashed border-line px-4 py-2 text-sm text-muted print:hidden">{t("rep.view.previewNote")}</p> : null}

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b-4 pb-5" style={{ borderColor: "var(--report-accent)" }}>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: "var(--report-accent)" }}>
            {t("rep.view.kicker")}
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl" dir="auto">
            {data.project.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            <bdi dir="ltr">{data.project.domain}</bdi> · {t("rep.view.range", { from: formatDay(data.from, lc), to: formatDay(data.to, lc) })}
          </p>
        </div>
        <div className="sm:text-end">
          {data.brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.brand.logo} alt={data.brand.company} className="h-10 max-w-48 object-contain sm:ms-auto" />
          ) : (
            <p className="text-lg font-bold" dir="auto">
              {data.brand.company}
            </p>
          )}
          <p className="mt-1 text-xs text-muted">{t("rep.view.prepared", { company: data.brand.company, date: formatDateTime(data.generatedAt, lc, false) })}</p>
        </div>
      </header>

      <div className="space-y-6 print:space-y-0">
        <Section title={t("rep.view.summary")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Figure label={t("ov.kpi.visibility")} value={<bdi>{pct(r.visibility)}</bdi>} hint={r.visibilityStart ? t("ov.kpi.was", { value: pct(r.visibilityStart) }) : undefined} />
            <Figure label={t("ov.kpi.avgPosition")} value={<bdi>{formatAveragePosition(r.averagePosition, lc)}</bdi>} hint={r.averageStart !== null ? t("ov.kpi.was", { value: formatAveragePosition(r.averageStart, lc) }) : undefined} />
            <Figure label={t("rep.view.top10")} value={<bdi>{formatNumber(r.top10, lc)}</bdi>} hint={t("rep.view.ofKeywords", { n: formatNumber(r.keywords, lc) })} />
            <Figure
              label={t("ov.kpi.movement")}
              value={
                <span className="text-lg sm:text-xl">
                  <bdi className="text-emerald-600 dark:text-emerald-400">▲ {formatNumber(r.up, lc)}</bdi> <bdi className="text-red-600 dark:text-red-400">▼ {formatNumber(r.down, lc)}</bdi>
                </span>
              }
            />
            <Figure
              label={t("ov.kpi.health")}
              value={data.audit?.score ?? "–"}
              hint={
                data.audit && data.audit.previousScore !== null && data.audit.score !== null
                  ? interpolateParts(t("rep.view.scoreChange"), { change: <bdi key="c" dir="ltr">{signed(data.audit.score - data.audit.previousScore)}</bdi> })
                  : undefined
              }
            />
            <Figure label={t("ov.kpi.clicks")} value={data.gsc ? <bdi>{formatNumber(data.gsc.totals.clicks, lc)}</bdi> : "–"} hint={data.gsc ? t("rep.view.impressions", { n: formatNumber(data.gsc.totals.impressions, lc) }) : undefined} />
          </div>
        </Section>

        <Section title={t("ov.visibilityTitle")} className="print:break-inside-avoid">
          <LineChart
            points={r.series.map((p) => ({ day: p.day, value: p.tracked ? p.visibility : null }))}
            format="share"
            locale={lc}
            label={t("ov.kpi.visibility")}
            height={180}
            emptyText={t("ov.noRankData")}
          />
        </Section>

        <Section title={t("rep.view.rankings")}>
          <p className="mb-3 text-sm text-muted">
            {plural(t, "rep.view.rankedOf", r.ranked, { n: formatNumber(r.ranked, lc), total: formatNumber(r.keywords, lc) })} · {t("rep.view.tops", { top3: formatNumber(r.top3, lc), top10: formatNumber(r.top10, lc), top100: formatNumber(r.top100, lc) })}
          </p>
          {r.rows.length ? (
            <div className="-mx-5 overflow-x-auto sm:-mx-6 print:mx-0 print:overflow-visible">
              <table className="w-full min-w-[560px] text-sm print:min-w-0">
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="border-b border-line px-3 py-2 ps-5 text-start font-medium sm:ps-6 print:ps-0">{t("rep.col.keyword")}</th>
                    <th scope="col" className="border-b border-line px-3 py-2 text-end font-medium">{t("rep.col.position")}</th>
                    <th scope="col" className="border-b border-line px-3 py-2 text-end font-medium">{t("rep.col.change")}</th>
                    <th scope="col" className="border-b border-line px-3 py-2 text-end font-medium">{t("rep.col.best")}</th>
                    <th scope="col" className="border-b border-line px-3 py-2 pe-5 text-start font-medium sm:pe-6 print:pe-0">{t("rep.col.url")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((k, i) => (
                    <tr key={`${k.phrase}-${k.country}-${k.device}-${i}`}>
                      <td className="max-w-56 border-b border-line px-3 py-2 ps-5 sm:ps-6 print:ps-0">
                        <span className="block truncate font-medium">
                          <bdi>{k.phrase}</bdi>
                        </span>
                        <span className="block text-[11px] text-muted">
                          <bdi dir="ltr">{k.country}</bdi> · {t(k.device === "mobile" ? "dash.device.mobile" : "dash.device.desktop")}
                        </span>
                      </td>
                      <td className="border-b border-line px-3 py-2 text-end font-semibold">
                        <PositionText position={k.position} locale={lc} />
                      </td>
                      <td className="border-b border-line px-3 py-2 text-end">
                        <ChangeText change={k.change} t={t} />
                      </td>
                      <td className="border-b border-line px-3 py-2 text-end text-muted">
                        <PositionText position={k.best} locale={lc} />
                      </td>
                      <td className="max-w-64 border-b border-line px-3 py-2 pe-5 sm:pe-6 print:pe-0">
                        <span dir="ltr" className="block truncate text-xs text-muted">
                          {k.url ? k.url.replace(/^https?:\/\/(www\.)?/, "") : "–"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">{t("rep.view.noKeywords")}</p>
          )}
        </Section>

        <Section title={t("ov.auditTitle")} className="print:break-before-page print:break-inside-avoid">
          {data.audit ? (
            <div className="grid gap-6 md:grid-cols-[auto_1fr]">
              <div className="flex items-center gap-4 md:flex-col md:items-start">
                <span className={cn("grid size-20 place-items-center rounded-full text-3xl font-bold tabular-nums", scoreTone(data.audit.score))}>{data.audit.score ?? "–"}</span>
                <div className="text-sm">
                  <p className="font-medium">{t(`ov.grade.${data.audit.grade}`)}</p>
                  <p className="text-muted">{plural(t, "ov.pagesCrawled", data.audit.pagesCrawled, { n: formatNumber(data.audit.pagesCrawled, lc) })}</p>
                  {data.audit.finishedAt ? <p className="text-muted">{formatDateTime(data.audit.finishedAt, lc, false)}</p> : null}
                </div>
              </div>
              <div className="min-w-0 space-y-4">
                <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
                  {(
                    [
                      ["seo.severity.critical", data.audit.critical, "text-red-600 dark:text-red-400"],
                      ["seo.severity.warning", data.audit.warning, "text-amber-600 dark:text-amber-400"],
                      ["seo.severity.notice", data.audit.notice, "text-muted"],
                      ["ov.newIssues", data.audit.newIssues, "text-ink"],
                      ["ov.fixedIssues", data.audit.fixedIssues, "text-emerald-600 dark:text-emerald-400"],
                    ] as const
                  ).map(([key, n, tone]) => (
                    <div key={key} className="rounded-lg border border-line px-2 py-2">
                      <dt className="truncate text-[11px] text-muted">{t(key)}</dt>
                      <dd className={cn("text-lg font-semibold tabular-nums", tone)}>{formatNumber(n, lc)}</dd>
                    </div>
                  ))}
                </dl>
                {data.audit.topIssues.length ? (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">{t("rep.view.topIssues")}</h3>
                    <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                      {data.audit.topIssues.map((i) => (
                        <li key={`${i.code}-${i.severity}`} className="flex items-center gap-3 px-3 py-2">
                          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", i.severity === "critical" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : i.severity === "warning" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-line/70 text-muted")}>
                            {t(`seo.severity.${i.severity}`)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{issueTitle(t, i.code)}</span>
                          <span className="text-xs text-muted tabular-nums">{plural(t, "rep.view.pages", i.count, { n: formatNumber(i.count, lc) })}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">{t("rep.view.noAudit")}</p>
          )}
        </Section>

        {data.gsc ? (
          <Section title={t("rep.view.gsc")} className="print:break-inside-avoid">
            <p className="mb-4 text-sm text-muted">
              <bdi dir="ltr">{data.gsc.property}</bdi> · {t("rep.view.range", { from: formatDay(data.gsc.from, lc), to: formatDay(data.gsc.to, lc) })}
              {data.gsc.demo ? ` · ${t("gsc.demoData")}` : ""}
            </p>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure label={t("gsc.metric.clicks")} value={<bdi>{formatNumber(data.gsc.totals.clicks, lc)}</bdi>} hint={data.gsc.previous.clicks ? t("ov.kpi.was", { value: formatNumber(data.gsc.previous.clicks, lc) }) : undefined} />
              <Figure label={t("gsc.metric.impressions")} value={<bdi>{formatNumber(data.gsc.totals.impressions, lc)}</bdi>} hint={data.gsc.previous.impressions ? t("ov.kpi.was", { value: formatNumber(data.gsc.previous.impressions, lc) }) : undefined} />
              <Figure label={t("gsc.metric.ctr")} value={<bdi>{pct(data.gsc.totals.ctr * 100)}</bdi>} />
              <Figure label={t("gsc.metric.position")} value={<bdi>{formatAveragePosition(data.gsc.totals.position, lc)}</bdi>} />
            </div>
            <LineChart points={data.gsc.series.map((d) => ({ day: d.day, value: d.clicks }))} format="number" locale={lc} label={t("gsc.metric.clicks")} height={160} emptyText={t("gsc.noData")} />
            {data.gsc.topQueries.length ? (
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-semibold">{t("rep.view.topQueries")}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th scope="col" className="w-1/2 border-b border-line py-2 text-start font-medium">{t("gsc.col.query")}</th>
                      <th scope="col" className="border-b border-line px-2 py-2 text-end font-medium">{t("gsc.metric.clicks")}</th>
                      <th scope="col" className="hidden border-b border-line px-2 py-2 text-end font-medium sm:table-cell print:table-cell">{t("gsc.metric.impressions")}</th>
                      <th scope="col" className="border-b border-line py-2 text-end font-medium">{t("gsc.metric.position")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.gsc.topQueries.map((q) => (
                      <tr key={q.key}>
                        <td className="max-w-0 truncate border-b border-line py-2">
                          <bdi>{q.key}</bdi>
                        </td>
                        <td className="border-b border-line px-2 py-2 text-end tabular-nums">{formatNumber(q.clicks, lc)}</td>
                        <td className="hidden border-b border-line px-2 py-2 text-end tabular-nums sm:table-cell print:table-cell">{formatNumber(q.impressions, lc)}</td>
                        <td className="border-b border-line py-2 text-end tabular-nums">{formatAveragePosition(q.position, lc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>
        ) : null}
      </div>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-muted">
        <span>{t("rep.view.footer", { company: data.brand.company })}</span>
        {data.brand.poweredBy ? (
          <a href={data.brand.poweredByUrl} target="_blank" rel="noopener" className="font-medium hover:text-ink">
            {data.brand.poweredBy}
          </a>
        ) : null}
      </footer>
    </div>
  );
}
