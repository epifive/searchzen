import { Check } from "lucide-react";
import type { MessageKey, Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { AUDIT_TOTALS, EXAMPLE_DOMAIN, num } from "./format";
import { ScoreRing, SEVERITY_DOT, WindowFrame } from "./mock-kit";
import { SectionHeading } from "./section-heading";

type Sev = keyof typeof SEVERITY_DOT;

/** Issues found per category, split by severity (example data). */
const CATEGORIES: Array<{ key: string; counts: Record<Sev, number> }> = [
  { key: "indexability", counts: { critical: 2, warning: 5, notice: 0 } },
  { key: "content", counts: { critical: 0, warning: 18, notice: 39 } },
  { key: "links", counts: { critical: 7, warning: 12, notice: 0 } },
  { key: "performance", counts: { critical: 0, warning: 3, notice: 9 } },
  { key: "social", counts: { critical: 0, warning: 0, notice: 14 } },
  { key: "technical", counts: { critical: 0, warning: 0, notice: 2 } },
];

const ISSUES: Array<{ key: string; severity: Sev; pages: number; change?: "new" }> = [
  { key: "issueBroken", severity: "critical", pages: 7, change: "new" },
  { key: "issueNoindex", severity: "critical", pages: 2 },
  { key: "issueRedirect", severity: "warning", pages: 12 },
  { key: "issueMeta", severity: "warning", pages: 18 },
  { key: "issueAlt", severity: "notice", pages: 41 },
];

function AuditMockup({ t, locale }: { t: Translator; locale: string }) {
  const max = Math.max(...CATEGORIES.map((c) => c.counts.critical + c.counts.warning + c.counts.notice));
  return (
    <div role="img" aria-label={t("home.audit.mockLabel")} className="relative mx-auto w-full max-w-[600px] select-none">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-emerald-400/20 via-primary/20 to-transparent blur-3xl" />
      <WindowFrame
        address={EXAMPLE_DOMAIN}
        extra={
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            <Check className="size-3" aria-hidden strokeWidth={3} />
            {t("home.audit.done", { n: num(500, locale) })}
          </span>
        }
      >
        <div className="space-y-3 p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex items-center gap-4 rounded-xl border border-line bg-paper/60 p-3 sm:flex-col sm:justify-center sm:px-5">
              <ScoreRing score={87} label={t("home.mock.good")} size={112} />
              <span className="space-y-1 text-[11px] sm:text-center">
                <span className="block font-semibold text-emerald-600 dark:text-emerald-400">{t("home.audit.scoreChange", { n: "+9" })}</span>
                <span className="flex flex-wrap gap-1.5 sm:justify-center">
                  <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">{t("home.mock.fixed", { n: num(14, locale) })}</span>
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-semibold text-red-700 dark:text-red-400">{t("home.mock.new", { n: num(2, locale) })}</span>
                </span>
              </span>
            </div>
            <div className="min-w-0 space-y-3">
              <dl className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["critical", t("home.mock.critical")],
                    ["warning", t("home.mock.warnings")],
                    ["notice", t("home.mock.notices")],
                  ] as const
                ).map(([sev, label]) => (
                  <div key={sev} className="flex min-w-0 flex-col-reverse rounded-xl border border-line px-2.5 py-2">
                    <dt className="flex items-center gap-1.5 truncate text-[10px] font-medium text-muted sm:text-[11px]">
                      <span className={cn("size-1.5 shrink-0 rounded-full", SEVERITY_DOT[sev])} />
                      {label}
                    </dt>
                    <dd className="font-display text-xl font-bold tabular-nums">
                      <bdi>{num(AUDIT_TOTALS[sev], locale)}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-line p-3">
                {CATEGORIES.map((c) => {
                  const total = c.counts.critical + c.counts.warning + c.counts.notice;
                  return (
                    <li key={c.key} className="min-w-0">
                      <span className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="truncate font-medium">{t(`home.audit.cat.${c.key}` as MessageKey)}</span>
                        <bdi className="text-muted tabular-nums">{num(total, locale)}</bdi>
                      </span>
                      <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-line/60">
                        {(["critical", "warning", "notice"] as const).map((s) =>
                          c.counts[s] ? <span key={s} className={SEVERITY_DOT[s]} style={{ width: `${(c.counts[s] / max) * 100}%` }} /> : null,
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <p className="flex items-center justify-between gap-2 border-b border-line bg-paper/70 px-3 py-2 text-[10px] font-semibold tracking-wide text-muted uppercase tall-script:normal-case">
              <span>{t("home.audit.issues")}</span>
              <span>{t("home.audit.pages")}</span>
            </p>
            <ul className="divide-y divide-line">
              {ISSUES.map((issue) => (
                <li key={issue.key} className="flex items-center gap-2.5 px-3 py-2 text-[12px]">
                  <span className={cn("size-2 shrink-0 rounded-full", SEVERITY_DOT[issue.severity])} />
                  <span className="min-w-0 flex-1 truncate font-medium">{t(`home.audit.${issue.key}` as MessageKey)}</span>
                  {issue.change ? (
                    <span className="shrink-0 rounded bg-red-500/10 px-1.5 py-px text-[9px] font-bold text-red-700 uppercase tall-script:normal-case dark:text-red-400">{t("home.audit.newBadge")}</span>
                  ) : null}
                  <bdi className="w-8 shrink-0 text-end font-semibold tabular-nums">{num(issue.pages, locale)}</bdi>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </WindowFrame>
    </div>
  );
}

/** The site audit: score gauge, issues by severity and category, example issues, plus the selling points. */
export function AuditShowcase({ t, locale }: { t: Translator; locale: string }) {
  const points = [t("home.audit.point1"), t("home.audit.point2"), t("home.audit.point3"), t("home.audit.point4")];
  return (
    <section id="audit" aria-labelledby="audit-title" className="scroll-mt-16 overflow-x-clip border-y border-line bg-surface py-24 sm:py-28">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div>
          <SectionHeading id="audit-title" eyebrow={t("home.audit.eyebrow")} title={t("home.audit.title")} text={t("home.audit.text")} />
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
        </div>
        <AuditMockup t={t} locale={locale} />
      </div>
    </section>
  );
}
