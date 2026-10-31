import { Braces, Hash, Mail, MessageSquare, MousePointerClick, Send, Users, Webhook } from "lucide-react";
import { BrandMark } from "@/components/site/logo";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";

interface Chip {
  name: string;
  hint?: string;
  /** Brand colour of the tile. */
  tile: string;
  icon?: typeof Mail;
  /** Short wordmark used instead of an icon. */
  mark?: string;
}

function ChipItem({ chip, side }: { chip: Chip; side: "in" | "out" }) {
  return (
    <li className={cn("flex items-center", side === "in" ? "lg:justify-end" : "lg:justify-start")}>
      <span className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-sm lg:w-auto lg:min-w-60">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg font-display text-[12px] font-bold text-white", chip.tile)}>
          {chip.icon ? <chip.icon className="size-4" aria-hidden /> : chip.mark}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{chip.name}</span>
          {chip.hint ? <span className="block truncate text-xs text-muted">{chip.hint}</span> : null}
        </span>
      </span>
    </li>
  );
}

/** Flowing lines from the left column into the hub and from the hub to the right column (wide screens). */
function Wires({ count, side }: { count: number; side: "in" | "out" }) {
  const h = count * 100;
  const mid = h / 2;
  return (
    <svg aria-hidden viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" className="absolute inset-0 hidden size-full lg:block rtl:-scale-x-100">
      {Array.from({ length: count }, (_, i) => {
        const y = i * 100 + 50;
        const d = side === "in" ? `M0 ${y} C55 ${y} 45 ${mid} 100 ${mid}` : `M0 ${mid} C55 ${mid} 45 ${y} 100 ${y}`;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke="var(--line)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <path
              d={d}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              className="animate-[sz-flow_3.2s_linear_infinite] [stroke-dasharray:0.08_0.92] motion-reduce:animate-none"
              style={{ animationDelay: `${-i * 0.55}s` }}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Data in (SERP APIs, Search Console) → the platform → alerts out, plus the REST API. */
export function Integrations({ t, site, apiUrl }: { t: Translator; site: string; apiUrl: string }) {
  const sources: Chip[] = [
    { name: "Serper", hint: "serper.dev", tile: "bg-[#0f172a] dark:bg-[#334155]", mark: "Se" },
    { name: "SerpApi", hint: "serpapi.com", tile: "bg-[#5b4fd6]", mark: "SA" },
    { name: "DataForSEO", hint: "dataforseo.com", tile: "bg-[#1565c0]", mark: "D4" },
    { name: "ValueSERP", hint: "valueserp.com", tile: "bg-[#0f9d58]", mark: "VS" },
    { name: "Google Search Console", hint: t("home.int.gscHint"), tile: "bg-[#ea4335]", icon: MousePointerClick },
    { name: t("home.int.restApi"), hint: t("home.int.restApiHint"), tile: "bg-[#1f2937] dark:bg-[#475569]", icon: Braces },
  ];
  const alerts: Chip[] = [
    { name: t("home.int.email"), tile: "bg-primary", icon: Mail },
    { name: "Slack", tile: "bg-[#4a154b]", icon: Hash },
    { name: "Discord", tile: "bg-[#5865f2]", icon: MessageSquare },
    { name: "Telegram", tile: "bg-[#229ed9]", icon: Send },
    { name: "Microsoft Teams", tile: "bg-[#5059c9]", icon: Users },
    { name: t("home.int.webhook"), hint: t("home.int.webhookHint"), tile: "bg-[#ea580c]", icon: Webhook },
  ];

  return (
    <section id="integrations" aria-labelledby="integrations-title" className="scroll-mt-16 pb-24 sm:pb-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mat-grid relative overflow-hidden rounded-[2rem] border border-line px-4 py-16 sm:px-10 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-80 max-w-3xl rounded-full bg-primary/15 blur-[100px]" />
          <SectionHeading id="integrations-title" align="center" eyebrow={t("home.int.eyebrow")} title={t("home.int.title")} text={t("home.int.text")} className="relative" />

          <div className="relative mt-14 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_14rem_minmax(0,1fr)] lg:gap-0">
            <div>
              <p className="mb-3 text-center text-xs font-semibold tracking-wide text-muted uppercase tall-script:normal-case lg:text-end">{t("home.int.sources")}</p>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {sources.map((c) => (
                  <ChipItem key={c.name} chip={c} side="in" />
                ))}
              </ul>
            </div>

            <div className="relative flex items-center justify-center lg:mt-7">
              <div className="relative grid h-full w-full grid-cols-[1fr_auto_1fr] items-center">
                <span className="relative h-full">
                  <Wires count={sources.length} side="in" />
                </span>
                <span className="relative grid size-24 place-items-center rounded-3xl border border-primary-line bg-surface shadow-[0_20px_50px_-20px_var(--primary)]">
                  <span aria-hidden className="absolute inset-0 animate-ping rounded-3xl border border-primary/30 [animation-duration:3s] motion-reduce:animate-none" />
                  <BrandMark className="size-12" />
                  <span className="sr-only">{site}</span>
                </span>
                <span className="relative h-full">
                  <Wires count={alerts.length} side="out" />
                </span>
              </div>
            </div>

            <div>
              <p className="mb-3 text-center text-xs font-semibold tracking-wide text-muted uppercase tall-script:normal-case lg:text-start">{t("home.int.alerts")}</p>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {alerts.map((c) => (
                  <ChipItem key={c.name} chip={c} side="out" />
                ))}
              </ul>
            </div>
          </div>

          <div className="relative mx-auto mt-14 max-w-3xl">
            <p className="text-center text-sm font-semibold">{t("home.int.api")}</p>
            <div dir="ltr" className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-[#0b1f27] px-4 py-3.5 text-start font-mono text-[13px] whitespace-nowrap text-cyan-50/90 shadow-xl">
              <span className="text-cyan-400">curl</span> <span className="text-emerald-300">&quot;{apiUrl}?project_id=12&quot;</span> <span className="text-amber-300">-H</span>{" "}
              <span className="text-emerald-300">&quot;Authorization: Bearer sz_…&quot;</span>
            </div>
            <p className="mt-3 text-center text-sm text-muted">{t("home.int.apiHint")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
