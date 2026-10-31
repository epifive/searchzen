import { LinkTabs } from "@/components/dashboard/ui";
import type { Translator } from "@/lib/i18n/messages";
import { SERP_FEATURES, type SerpFeature } from "@/seo/types";

export const RANK_PERIODS = [7, 30, 90] as const;
export type RankPeriod = (typeof RANK_PERIODS)[number];

export function parsePeriod(v: string | undefined): RankPeriod {
  const n = Number(v);
  return (RANK_PERIODS as readonly number[]).includes(n) ? (n as RankPeriod) : 30;
}

/** Keywords / Competitors tabs and the 7 / 30 / 90-day period tabs of the Rankings section. */
export function RankNav({ projectId, active, period, t, extra = "" }: { projectId: number; active: "keywords" | "competitors"; period: RankPeriod; t: Translator; extra?: string }) {
  const base = `/dashboard/projects/${projectId}/rankings`;
  const q = (p: number) => `?period=${p}${extra}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <LinkTabs
        label={t("rank.nav.label")}
        items={[
          { href: `${base}?period=${period}`, label: t("rank.nav.keywords"), active: active === "keywords" },
          { href: `${base}/competitors?period=${period}`, label: t("rank.nav.competitors"), active: active === "competitors" },
        ]}
      />
      <LinkTabs
        label={t("rank.period.label")}
        items={RANK_PERIODS.map((p) => ({ href: `${active === "competitors" ? `${base}/competitors` : base}${q(p)}`, label: t("rank.period.days", { n: p }), active: p === period }))}
      />
    </div>
  );
}

/** Translated SERP feature names. */
export function featureLabels(t: Translator): Record<SerpFeature, string> {
  return Object.fromEntries(SERP_FEATURES.map((f) => [f, t(`seo.feature.${f}`)])) as Record<SerpFeature, string>;
}
