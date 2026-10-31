import type { CSSProperties } from "react";
import { CalendarClock, Check, Link2, Lock, Mail } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { areaPaths, exampleSeries } from "./chart";
import { num, pct } from "./format";
import { ChangeText, PositionPill } from "./mock-kit";
import { SectionHeading } from "./section-heading";

const CHART_W = 560;
const CHART_H = 110;
/** The client's brand colour: reports carry the agency's / client's colours, not the platform's. */
const ACCENT = "#7c3aed";
const CLIENT_DOMAIN = "northwinddental.example";

const ROWS = [
  { phrase: "dentist near me", position: 2, delta: 3 },
  { phrase: "teeth whitening portland", position: 4, delta: 6 },
  { phrase: "emergency dentist", position: 7, delta: -1 },
  { phrase: "invisalign cost", position: 9, delta: 4 },
];

function ReportMockup({ t, locale, host }: { t: Translator; locale: string; host: string }) {
  const { line, area, last } = areaPaths(exampleSeries(30, 300, 2), CHART_W, CHART_H, 8);
  const figures = [
    { label: t("home.report.visibility"), value: pct(38.2, locale) },
    { label: t("home.report.avgPosition"), value: num(7.4, locale, { minimumFractionDigits: 1 }) },
    { label: t("home.report.clicks"), value: num(12480, locale) },
    { label: t("home.report.health"), value: num(91, locale) },
  ];
  return (
    <div role="img" aria-label={t("home.report.mockLabel")} className="relative mx-auto w-full max-w-[600px] select-none" style={{ "--report-accent": ACCENT } as CSSProperties}>
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-bl from-violet-500/25 via-primary/15 to-transparent blur-3xl" />

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_100px_-40px_rgba(76,29,149,0.5)] dark:shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]">
        <div className="h-1.5" style={{ background: "var(--report-accent)" }} />
        <div className="p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-widest uppercase tall-script:tracking-normal" style={{ color: "var(--report-accent)" }}>
                {t("home.report.kicker")}
              </p>
              <p className="mt-1 font-display text-xl font-bold tracking-tight">Northwind Dental</p>
              <p className="mt-0.5 text-[11px] text-muted">
                <bdi dir="ltr">{CLIENT_DOMAIN}</bdi> · {t("home.report.period")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg font-display text-sm font-bold text-white" style={{ background: "var(--report-accent)" }}>
                B
              </span>
              <span className="text-[11px] leading-tight">
                <span className="block font-bold">Brightline</span>
                <span className="block text-muted">{t("home.report.agency")}</span>
              </span>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {figures.map((f) => (
              <div key={f.label} className="flex min-w-0 flex-col-reverse rounded-lg border border-line px-2.5 py-2">
                <dt className="truncate text-[10px] font-medium text-muted">{f.label}</dt>
                <dd className="font-display text-lg font-bold tabular-nums">
                  <bdi>{f.value}</bdi>
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4">
            <p className="text-[11px] font-semibold" style={{ color: "var(--report-accent)" }}>
              {t("home.report.chart")}
            </p>
            <div className="relative mt-2 h-20">
              <svg aria-hidden viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible rtl:-scale-x-100">
                <defs>
                  <linearGradient id="sz-report-area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor={ACCENT} stopOpacity="0.28" />
                    <stop offset="1" stopColor={ACCENT} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0.33, 0.66].map((f) => (
                  <line key={f} x1="0" x2={CHART_W} y1={CHART_H * f} y2={CHART_H * f} stroke="var(--line)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
                ))}
                <path d={area} fill="url(#sz-report-area)" />
                <path d={line} fill="none" stroke={ACCENT} strokeWidth="2.25" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
              <span
                aria-hidden
                className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface rtl:hidden"
                style={{ left: `${(last[0] / CHART_W) * 100}%`, top: `${(last[1] / CHART_H) * 100}%`, background: ACCENT }}
              />
            </div>
          </div>

          <ul className="mt-4 divide-y divide-line border-t border-line text-[12px]">
            {ROWS.map((r) => (
              <li key={r.phrase} className="flex items-center gap-3 py-2">
                <bdi dir="ltr" className="min-w-0 flex-1 truncate text-start font-medium">
                  {r.phrase}
                </bdi>
                <PositionPill position={r.position} locale={locale} />
                <ChangeText delta={r.delta} locale={locale} className="w-9 text-end" />
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Share link card. */}
      <div
        aria-hidden
        className="absolute -end-6 -top-[4.5rem] z-10 hidden w-[250px] animate-[sz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.6s_both] rounded-xl border border-line bg-surface/95 p-3 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.35)] backdrop-blur motion-reduce:animate-none lg:block xl:-end-12 dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]"
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold">
          <Link2 className="size-3.5 text-primary-text" />
          {t("home.report.link")}
          <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-1.5 py-px text-[10px] text-emerald-700 dark:text-emerald-400">
            <Lock className="size-2.5" />
            {t("home.report.password")}
          </span>
        </span>
        <span dir="ltr" className="mt-2 block truncate rounded-md border border-line bg-paper px-2 py-1 text-start font-mono text-[10.5px]">
          {host}/r/k8Fq2xVbT3
        </span>
      </div>

      {/* Scheduled email. */}
      <div
        aria-hidden
        className="absolute -start-4 -bottom-8 z-10 hidden w-[250px] animate-[sz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_1s_both] items-center gap-3 rounded-xl border border-line bg-surface/95 p-3 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.35)] backdrop-blur motion-reduce:animate-none lg:flex xl:-start-14 dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-white">
          <Mail className="size-4" />
        </span>
        <span className="min-w-0 text-[11px] leading-snug">
          <span className="block font-semibold">{t("home.report.scheduled")}</span>
          <span className="flex items-center gap-1 text-muted">
            <CalendarClock className="size-3 shrink-0" />
            {t("home.report.scheduledWhen", { n: num(3, locale) })}
          </span>
        </span>
      </div>
    </div>
  );
}

/** White-label client reports: a branded report with its share link and schedule, plus the badge. */
export function ReportShowcase({ t, locale, host, badgeUrl }: { t: Translator; locale: string; host: string; badgeUrl: string }) {
  const points = [t("home.report.point1"), t("home.report.point2"), t("home.report.point3"), t("home.report.point4")];
  return (
    <section id="reports" aria-labelledby="reports-title" className="scroll-mt-16 overflow-x-clip py-24 sm:py-28">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-20">
        <div className="order-2 lg:order-1">
          <ReportMockup t={t} locale={locale} host={host} />
        </div>
        <div className="order-1 lg:order-2">
          <SectionHeading id="reports-title" eyebrow={t("home.report.eyebrow")} title={t("home.report.title")} text={t("home.report.text")} />
          <ul className="mt-8 space-y-4">
            {points.map((p) => (
              <li key={p} className="flex gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-text">
                  <Check className="size-3.5" aria-hidden strokeWidth={3} />
                </span>
                <span className="leading-relaxed text-muted">{p}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold">{t("home.report.badgeTitle")}</p>
              {/* The badge as the embed script renders it. */}
              <span
                aria-hidden
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 font-sans text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <span className="size-2 rounded-full bg-green-600" />
                {t("home.report.badgeLabel")} <bdi dir="ltr">91/100</bdi>
              </span>
            </div>
            <div dir="ltr" className="mt-3 overflow-x-auto rounded-lg bg-[#0b1f27] px-3.5 py-2.5 text-start font-mono text-[12px] leading-relaxed whitespace-nowrap text-cyan-50/90">
              <p>
                <span className="text-cyan-400">&lt;script</span> <span className="text-amber-300">async</span> <span className="text-amber-300">src</span>=<span className="text-emerald-300">&quot;{badgeUrl}&quot;</span>
              </p>
              <p className="ps-4">
                <span className="text-amber-300">data-project</span>=<span className="text-emerald-300">&quot;k8Fq2xVbT3&quot;</span>
                <span className="text-cyan-400">&gt;&lt;/script&gt;</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
