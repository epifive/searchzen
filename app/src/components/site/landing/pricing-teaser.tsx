import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { cn, formatMoney } from "@/lib/utils";
import { formatLimit } from "@/seo/format";
import { SectionHeading } from "./section-heading";

export interface TeaserPlan {
  id: number;
  name: string;
  description: string | null;
  /** Minor units. */
  priceMonthly: number;
  isFree: boolean;
  isFeatured: boolean;
  /** 0 = unlimited. */
  maxProjects: number;
  /** 0 = unlimited. */
  maxKeywords: number;
  checkFrequency: "daily" | "weekly";
  /** 0 = unlimited. */
  maxAuditPages: number;
}

/** A compact overview of the active plans; the full comparison lives on /pricing. */
export function PricingTeaser({ t, plans, currency, locale }: { t: Translator; plans: TeaserPlan[]; currency: string; locale: string }) {
  const shown = plans.slice(0, 3);
  if (!shown.length) return null;
  return (
    <section aria-labelledby="pricing-title" className="border-y border-line bg-surface py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading id="pricing-title" eyebrow={t("home.pricingEyebrow")} title={t("home.pricingTitle")} text={t("home.pricingText")} />
          <Link href="/pricing" className="group inline-flex items-center gap-1.5 font-semibold text-primary-text hover:underline">
            {t("home.pricingAll")}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
          </Link>
        </div>

        <ul className={cn("mt-12 grid grid-cols-1 gap-5", shown.length >= 3 ? "md:grid-cols-3" : shown.length === 2 ? "md:grid-cols-2" : "max-w-md")}>
          {shown.map((plan) => (
            <li key={plan.id}>
              <Link
                href="/pricing"
                className={cn(
                  "relative flex h-full flex-col rounded-2xl border bg-paper p-6 transition-all hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
                  plan.isFeatured ? "border-primary shadow-[0_24px_48px_-28px_var(--primary)]" : "border-line hover:border-primary-line",
                )}
              >
                {plan.isFeatured ? <span className="absolute -top-3 start-6 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white">{t("pricing.recommended")}</span> : null}
                <span className="text-lg font-bold">{plan.name}</span>
                <span className="mt-4 flex items-baseline gap-2">
                  <bdi className="font-display text-4xl font-bold tracking-tight">{formatMoney(plan.isFree ? 0 : plan.priceMonthly, currency, locale)}</bdi>
                  <span className="text-sm text-muted">{plan.isFree ? t("pricing.forever") : t("pricing.perMonth")}</span>
                </span>
                {plan.description ? (
                  <span dir="auto" className="mt-2 text-sm text-muted">
                    {plan.description}
                  </span>
                ) : null}
                <span className="mt-6 block space-y-2.5 border-t border-line pt-5 text-sm">
                  {(
                    [
                      [t("pricing.projects"), formatLimit(plan.maxProjects, t, locale)],
                      [t("pricing.keywords"), formatLimit(plan.maxKeywords, t, locale)],
                      [t("pricing.checks"), plan.checkFrequency === "daily" ? t("pricing.daily") : t("pricing.weekly")],
                      [t("pricing.auditPages"), formatLimit(plan.maxAuditPages, t, locale)],
                    ] as const
                  ).map(([label, value]) => (
                    <span key={label} className="flex items-baseline justify-between gap-3">
                      <span className="text-muted">{label}</span>
                      <bdi className="font-semibold tabular-nums">{value}</bdi>
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
