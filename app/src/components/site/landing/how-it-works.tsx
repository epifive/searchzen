import { CalendarClock, CheckCircle2, Globe, Hash, Link2, Lock, Mail, ScanSearch } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { EXAMPLE_DOMAIN, EXAMPLE_KEYWORDS, num } from "./format";
import { SectionHeading } from "./section-heading";

/** Three steps from adding a site to the first client report, each with a small illustration. */
export function HowItWorks({ t, locale, host }: { t: Translator; locale: string; host: string }) {
  const steps = [
    {
      title: t("home.step1Title"),
      text: t("home.step1Text"),
      visual: (
        <div aria-hidden className="space-y-2 rounded-xl border border-line bg-surface px-3.5 py-3">
          <span className="flex items-center gap-2 rounded-lg border border-primary-line bg-paper px-2.5 py-1.5 ring-2 ring-primary/15">
            <Globe className="size-3.5 shrink-0 text-primary-text" />
            <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono text-xs font-semibold">
              {EXAMPLE_DOMAIN}
            </span>
          </span>
          <span className="flex flex-wrap gap-1.5">
            {EXAMPLE_KEYWORDS.slice(0, 3).map((k) => (
              <span key={k.phrase} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary-text">
                <bdi dir="ltr" className="truncate">
                  {k.phrase}
                </bdi>
              </span>
            ))}
            <span className="rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-muted">{t("home.step1More", { n: num(117, locale) })}</span>
          </span>
        </div>
      ),
    },
    {
      title: t("home.step2Title"),
      text: t("home.step2Text"),
      visual: (
        <div aria-hidden className="space-y-2.5 rounded-xl border border-line bg-surface px-3.5 py-3">
          <span className="flex items-center gap-2 text-xs">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="min-w-0 flex-1 truncate font-semibold">{t("home.step2Rank", { n: num(120, locale) })}</span>
            <span className="shrink-0 text-[11px] text-muted">
              <bdi dir="ltr">06:00</bdi>
            </span>
          </span>
          <span className="block">
            <span className="flex items-center gap-2 text-xs">
              <ScanSearch className="size-4 shrink-0 text-primary-text" />
              <span className="min-w-0 flex-1 truncate font-semibold">{t("home.step2Crawl")}</span>
              <bdi className="shrink-0 text-[11px] text-muted tabular-nums">
                {num(412, locale)} / {num(500, locale)}
              </bdi>
            </span>
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line/70">
              <span className="block h-full w-[82%] rounded-full bg-gradient-to-r from-primary to-sky-400 rtl:bg-gradient-to-l" />
            </span>
          </span>
        </div>
      ),
    },
    {
      title: t("home.step3Title"),
      text: t("home.step3Text"),
      visual: (
        <div aria-hidden className="space-y-2 rounded-xl border border-line bg-surface px-3.5 py-3">
          <span className="flex items-center gap-2 rounded-lg bg-paper px-2.5 py-1.5">
            <Link2 className="size-3.5 shrink-0 text-primary-text" />
            <span dir="ltr" className="min-w-0 flex-1 truncate text-start font-mono text-[11px]">
              {host}/r/k8Fq2xVb…
            </span>
            <Lock className="size-3.5 shrink-0 text-muted" />
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 font-medium text-primary-text">
              <CalendarClock className="size-3" />
              {t("home.step3Weekly")}
            </span>
            <span className="ms-auto flex gap-1">
              <span className="grid size-6 place-items-center rounded-md bg-primary text-white">
                <Mail className="size-3" />
              </span>
              <span className="grid size-6 place-items-center rounded-md bg-[#4a154b] text-white">
                <Hash className="size-3" />
              </span>
              <span className="grid size-6 place-items-center rounded-md bg-[#5865f2] font-display text-[9px] font-bold text-white">D</span>
            </span>
          </span>
        </div>
      ),
    },
  ];

  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 border-b border-line bg-surface py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading id="how-title" align="center" eyebrow={t("home.howEyebrow")} title={t("home.howTitle")} text={t("home.howText")} />
        <ol className="relative mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* The dashed path that links the three steps on wide screens. */}
          <span aria-hidden className="absolute inset-x-[16%] top-14 hidden border-t-2 border-dashed border-primary-line md:block" />
          {steps.map((step, i) => (
            <li key={step.title} className="relative flex flex-col rounded-2xl border border-line bg-paper p-6 sm:p-7">
              <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-primary font-display text-2xl font-bold text-white shadow-lg shadow-primary/30">
                <span className="sr-only">{t("home.howStep", { n: i + 1 })}</span>
                <span aria-hidden>{i + 1}</span>
              </span>
              <h3 className="mt-6 text-xl font-bold tall-script:leading-snug">{step.title}</h3>
              <p className="mt-2 flex-1 leading-relaxed text-muted">{step.text}</p>
              <div className="mt-6">{step.visual}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
