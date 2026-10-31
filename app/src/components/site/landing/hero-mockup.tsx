import { Hash, Monitor, MapPin, Smartphone, TrendingUp } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { AUDIT_TOTALS, EXAMPLE_DOMAIN, EXAMPLE_KEYWORDS, num, pct } from "./format";
import { ChangeText, FeatureTiles, PositionPill, ScoreRing, SEVERITY_DOT, TrendLine, WindowFrame } from "./mock-kit";

/**
 * The hero illustration: an example rank tracking dashboard (KPIs and the keyword table with
 * positions, changes, SERP features and trends), with a site health card and a Slack alert
 * floating around it. Plain HTML/SVG: no JavaScript.
 */
export function HeroMockup({ t, locale }: { t: Translator; locale: string }) {
  const kpis = [
    { label: t("home.mock.visibility"), value: pct(46.2, locale), change: `+${num(5.4, locale)}` },
    { label: t("home.mock.avgPosition"), value: num(5.8, locale, { minimumFractionDigits: 1 }), change: `▲ ${num(1.3, locale)}` },
    { label: t("home.mock.top3"), value: num(18, locale), change: `+${num(4, locale)}` },
    { label: t("home.mock.top10"), value: num(52, locale), change: `+${num(7, locale)}` },
  ];

  return (
    <div role="img" aria-label={t("home.mock.label")} className="relative mx-auto w-full max-w-[640px] select-none">
      <div aria-hidden className="absolute -inset-8 -z-10 rounded-[3rem] bg-gradient-to-br from-primary/30 via-sky-400/15 to-transparent blur-3xl" />

      <WindowFrame
        address={EXAMPLE_DOMAIN}
        className="animate-tz-pop motion-reduce:animate-none"
        extra={
          <>
            <span className="rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted max-[420px]:hidden">{t("home.mock.period")}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="relative flex size-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/70 motion-reduce:animate-none" />
                <span className="relative size-1.5 rounded-full bg-emerald-500" />
              </span>
              {t("home.mock.checked")}
            </span>
          </>
        }
      >
        <div className="space-y-3 p-3 sm:p-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {kpis.map((k, i) => (
              <div
                key={k.label}
                className={cn(
                  "relative flex min-w-0 flex-col-reverse justify-end rounded-xl border px-3 py-2.5",
                  i === 0 ? "border-primary-line bg-primary-soft" : "border-line bg-paper/60",
                )}
              >
                <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                  <bdi className="font-display text-lg font-bold tracking-tight tabular-nums sm:text-xl">{k.value}</bdi>
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 sm:text-[11px] dark:text-emerald-400">
                    {i === 0 ? <TrendingUp className="size-3" aria-hidden /> : null}
                    <bdi dir="ltr">{k.change}</bdi>
                  </span>
                </dd>
                <dt className="truncate text-[10px] font-medium text-muted sm:text-[11px]">{k.label}</dt>
                {i === 0 ? <span aria-hidden className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
              </div>
            ))}
          </dl>

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_3rem] items-center gap-x-3 border-b border-line bg-paper/70 px-3 py-2 text-[10px] font-semibold tracking-wide text-muted uppercase tall-script:normal-case sm:grid-cols-[minmax(0,1fr)_2.75rem_3rem_4.25rem_4.25rem]">
              <span>{t("home.mock.keyword")}</span>
              <span className="text-center">{t("home.mock.position")}</span>
              <span className="text-end">{t("home.mock.change")}</span>
              <span className="max-sm:hidden">{t("home.mock.serp")}</span>
              <span className="text-end max-sm:hidden">{t("home.mock.trend")}</span>
            </div>
            <ul className="divide-y divide-line">
              {EXAMPLE_KEYWORDS.map((k, i) => {
                const DeviceIcon = k.device === "mobile" ? Smartphone : Monitor;
                return (
                  <li
                    key={k.phrase}
                    className={cn(
                      "relative grid grid-cols-[minmax(0,1fr)_2.75rem_3rem] items-center gap-x-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_2.75rem_3rem_4.25rem_4.25rem]",
                      i === 0 && "bg-emerald-500/[0.06]",
                    )}
                  >
                    {i === 0 ? <span aria-hidden className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-emerald-500" /> : null}
                    <span className="min-w-0">
                      <bdi dir="ltr" className="block truncate text-start text-[12.5px] font-semibold">
                        {k.phrase}
                      </bdi>
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
                        <span dir="ltr" className="rounded border border-line px-1 font-mono font-medium">
                          {k.country}
                        </span>
                        <DeviceIcon className="size-3" aria-hidden />
                        {k.location ? (
                          <span className="inline-flex min-w-0 items-center gap-0.5 truncate">
                            <MapPin className="size-3 shrink-0" aria-hidden />
                            <bdi dir="ltr" className="truncate">
                              {k.location}
                            </bdi>
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="text-center">
                      <PositionPill position={k.position} locale={locale} />
                    </span>
                    <ChangeText delta={k.delta} locale={locale} className="text-end" />
                    <FeatureTiles features={k.features} className="max-sm:hidden" />
                    <span className="flex justify-end max-sm:hidden">
                      <TrendLine points={k.trend} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </WindowFrame>

      {/* Slack alert. Anchored by its bottom edge: a wrapped translation grows upwards. */}
      <div
        aria-hidden
        className="absolute -end-4 bottom-[calc(100%+0.75rem)] z-10 hidden w-[310px] animate-[sz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_1.2s_both] items-start gap-3 rounded-xl border border-line bg-surface/95 p-3 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.35)] backdrop-blur motion-reduce:animate-none lg:flex xl:-end-8 dark:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#4a154b] text-white">
          <Hash className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 text-start text-[13px] leading-snug font-semibold">{t("home.mock.toastTitle")}</span>
            <span className="shrink-0 pt-0.5 text-[10px] text-muted">
              Slack · {t("home.mock.now")}
            </span>
          </span>
          <span className="mt-0.5 block text-start text-[11px] leading-snug text-muted">
            {t("home.mock.toastText", { keyword: EXAMPLE_KEYWORDS[0].phrase, position: num(3, locale), change: num(5, locale) })}
          </span>
        </span>
      </div>

      {/* Site health card: the audit side of the same project. */}
      <div
        aria-hidden
        className="absolute -start-12 -bottom-36 z-10 hidden w-[270px] animate-[sz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.8s_both] rounded-2xl border border-line bg-surface/95 p-4 shadow-[0_24px_50px_-18px_rgba(15,23,42,0.4)] backdrop-blur motion-reduce:animate-none lg:block xl:-start-20 dark:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.85)]"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-muted">{t("home.mock.health")}</span>
          <span className="rounded-md bg-emerald-500/12 px-1.5 py-px text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
            <bdi dir="ltr">+9</bdi>
          </span>
        </span>
        <span className="mt-3 flex items-center gap-4">
          <ScoreRing score={87} label={t("home.mock.good")} size={84} />
          <span className="min-w-0 flex-1 space-y-1.5 text-[11px]">
            {(
              [
                ["critical", t("home.mock.critical"), AUDIT_TOTALS.critical],
                ["warning", t("home.mock.warnings"), AUDIT_TOTALS.warning],
                ["notice", t("home.mock.notices"), AUDIT_TOTALS.notice],
              ] as const
            ).map(([sev, label, n]) => (
              <span key={sev} className="flex items-center gap-1.5">
                <span className={cn("size-1.5 shrink-0 rounded-full", SEVERITY_DOT[sev])} />
                <span className="min-w-0 flex-1 truncate text-muted">{label}</span>
                <bdi className="font-semibold tabular-nums">{num(n, locale)}</bdi>
              </span>
            ))}
          </span>
        </span>
        <span className="mt-3 flex gap-1.5 border-t border-line pt-3 text-[10px] font-semibold">
          <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">{t("home.mock.fixed", { n: num(14, locale) })}</span>
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-700 dark:text-red-400">{t("home.mock.new", { n: num(2, locale) })}</span>
        </span>
      </div>
    </div>
  );
}
