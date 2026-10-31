import type { Device, SerpFeature } from "@/seo/types";

/** A grouped number in the visitor's locale. */
export function num(n: number, locale: string, options?: Intl.NumberFormatOptions): string {
  try {
    return n.toLocaleString(locale, options);
  } catch {
    return n.toLocaleString("en", options);
  }
}

/** 46.2 → "46.2%" in the visitor's locale. */
export function pct(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 100);
  } catch {
    return `${value.toFixed(1)}%`;
  }
}

export interface ExampleKeyword {
  phrase: string;
  country: string;
  device: Device;
  location?: string;
  position: number;
  /** Positions gained (positive) or lost (negative) since the start of the period. */
  delta: number;
  features: SerpFeature[];
  /** Daily positions, oldest first (lower is better). */
  trend: number[];
}

/** Example keywords of the illustrations: one running-shoe shop, so the story stays consistent. */
export const EXAMPLE_DOMAIN = "stridewell.example";

export const EXAMPLE_KEYWORDS: ExampleKeyword[] = [
  {
    phrase: "trail running shoes",
    country: "US",
    device: "mobile",
    position: 3,
    delta: 5,
    features: ["shopping", "images"],
    trend: [9, 9, 8, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3],
  },
  {
    phrase: "running shoes for flat feet",
    country: "US",
    device: "desktop",
    position: 2,
    delta: 3,
    features: ["featured_snippet", "people_also_ask"],
    trend: [5, 5, 6, 5, 4, 4, 4, 3, 3, 3, 2, 3, 2, 2],
  },
  {
    phrase: "running store austin",
    country: "US",
    device: "mobile",
    location: "Austin, TX",
    position: 1,
    delta: 1,
    features: ["local_pack"],
    trend: [2, 2, 2, 3, 2, 2, 2, 1, 2, 1, 1, 1, 1, 1],
  },
  {
    phrase: "carbon plate racing shoes",
    country: "GB",
    device: "desktop",
    position: 8,
    delta: 12,
    features: ["videos", "top_stories"],
    trend: [20, 19, 18, 18, 16, 15, 14, 13, 12, 11, 10, 9, 9, 8],
  },
  {
    phrase: "marathon training plan",
    country: "CA",
    device: "desktop",
    position: 11,
    delta: -2,
    features: ["ai_overview", "people_also_ask"],
    trend: [9, 9, 8, 9, 9, 10, 9, 10, 10, 11, 10, 11, 11, 11],
  },
];

/** Issue counts of the example site audit (hero card and audit showcase). */
export const AUDIT_TOTALS = { critical: 9, warning: 38, notice: 64 } as const;
