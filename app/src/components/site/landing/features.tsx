import { BadgeCheck, BellRing, Braces, Building2, Crosshair, Eye, FileText, History, Languages, LineChart, MousePointerClick, ScanSearch } from "lucide-react";
import type { MessageKey, Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";

const FEATURES: Array<{ icon: typeof LineChart; key: string; accent?: string }> = [
  { icon: LineChart, key: "rank" },
  { icon: Crosshair, key: "serp" },
  { icon: Eye, key: "visibility" },
  { icon: MousePointerClick, key: "gsc", accent: "bg-[#1a73e8]/12 text-[#1a73e8] dark:text-[#8ab4f8]" },
  { icon: ScanSearch, key: "audit" },
  { icon: History, key: "history", accent: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  { icon: FileText, key: "reports" },
  { icon: BadgeCheck, key: "badge", accent: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" },
  { icon: BellRing, key: "alerts" },
  { icon: Braces, key: "api" },
  { icon: Languages, key: "lang" },
  { icon: Building2, key: "saas", accent: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
];

export function Features({ t }: { t: Translator }) {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-16 py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading id="features-title" eyebrow={t("home.featuresEyebrow")} title={t("home.featuresTitle")} text={t("home.featuresText")} />
        <ul className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.key} className="group relative bg-surface p-6 transition-colors hover:bg-paper/60 sm:p-7">
              <span
                className={cn(
                  "grid size-11 place-items-center rounded-xl ring-1 ring-current/10 transition-transform ring-inset group-hover:-translate-y-0.5 motion-reduce:group-hover:translate-y-0",
                  f.accent ?? "bg-primary-soft text-primary-text",
                )}
              >
                <f.icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-5 text-[17px] font-bold tall-script:leading-snug">{t(`home.f.${f.key}Title` as MessageKey)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(`home.f.${f.key}Text` as MessageKey)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
