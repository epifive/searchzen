import type { ReactNode } from "react";
import { BookOpen, CirclePlay, Image, Link2, MapPin, MessageCircleQuestionMark, Monitor, Newspaper, ShoppingCart, Smartphone, Sparkles, TextQuote, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { changeTone, formatChange, formatPosition } from "@/seo/format";
import type { PositionChange } from "@/seo/normalize";
import type { Device, SerpFeature } from "@/seo/types";

/** Server-safe building blocks of the rank tracking pages (no client JS). */

export const FEATURE_ICONS: Record<SerpFeature, LucideIcon> = {
  featured_snippet: TextQuote,
  local_pack: MapPin,
  ai_overview: Sparkles,
  people_also_ask: MessageCircleQuestionMark,
  images: Image,
  videos: CirclePlay,
  top_stories: Newspaper,
  shopping: ShoppingCart,
  sitelinks: Link2,
  knowledge_panel: BookOpen,
};

/**
 * Categorical series colours (validated for colour-vision deficiencies in light and dark mode):
 * slot 0 is the project, the next ones its competitors, always in the same order.
 */
export const SERIES_COLORS = [
  { stroke: "stroke-[#0284a8] dark:stroke-[#22a3c4]", bg: "bg-[#0284a8] dark:bg-[#22a3c4]" },
  { stroke: "stroke-[#eb6834] dark:stroke-[#d95926]", bg: "bg-[#eb6834] dark:bg-[#d95926]" },
  { stroke: "stroke-[#6250d6] dark:stroke-[#9085e9]", bg: "bg-[#6250d6] dark:bg-[#9085e9]" },
  { stroke: "stroke-[#eda100] dark:stroke-[#c98500]", bg: "bg-[#eda100] dark:bg-[#c98500]" },
  { stroke: "stroke-[#e87ba4] dark:stroke-[#d55181]", bg: "bg-[#e87ba4] dark:bg-[#d55181]" },
  { stroke: "stroke-[#008300] dark:stroke-[#008300]", bg: "bg-[#008300] dark:bg-[#008300]" },
] as const;

/** A position ("7", "–" / "20+" when not ranked); muted when not ranked. */
export function Position({ position, depth, locale, className }: { position: number | null | undefined; depth?: number; locale: string; className?: string }) {
  const ranked = typeof position === "number" && position > 0;
  return (
    <bdi className={cn("tabular-nums", ranked ? "font-semibold text-ink" : "text-muted", className)}>{formatPosition(position ?? null, { depth: ranked ? undefined : depth, locale })}</bdi>
  );
}

/** Change badge ("▲ 8", "▼ 3", "new", "lost"); empty when there is nothing to compare. */
export function Change({ change, labels, className }: { change: PositionChange | null | undefined; labels: { new: string; lost: string }; className?: string }) {
  if (!change || change.kind === "none") return <span className="text-muted">–</span>;
  return <bdi className={cn("text-xs font-semibold whitespace-nowrap tabular-nums", changeTone(change), className)}>{formatChange(change, labels)}</bdi>;
}

/** SERP feature icons with accessible names. */
export function FeatureIcons({ features, labels, className }: { features: SerpFeature[]; labels: Record<SerpFeature, string>; className?: string }) {
  if (!features.length) return <span className="text-muted">–</span>;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1 text-muted", className)}>
      {features.map((f) => {
        const Icon = FEATURE_ICONS[f];
        return (
          <span key={f} title={labels[f]} className="inline-flex">
            <Icon className="size-3.5" aria-hidden />
            <span className="sr-only">{labels[f]}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Position sparkline: lower positions draw higher (rank 1 at the top), gaps where not ranked.
 * The y-range is the keyword's own range, so small moves stay visible.
 */
export function Sparkline({ points, label, className, width = 84, height = 26 }: { points: Array<number | null>; label: string; className?: string; width?: number; height?: number }) {
  const W = width;
  const H = height;
  const values = points.filter((p): p is number => p !== null);
  if (values.length < 2) return <span className="text-muted">–</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(4, max - min);
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - 4) + 2);
  const y = (p: number) => 3 + ((p - min) / span) * (H - 6);
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const lastIndex = points.length - 1 - [...points].reverse().findIndex((p) => p !== null);
  const last = points[lastIndex];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} className={cn("overflow-visible rtl:-scale-x-100", className)}>
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="stroke-primary" />
      ))}
      {last !== null && last !== undefined ? <circle cx={x(lastIndex)} cy={y(last)} r={2.5} className="fill-primary" /> : null}
    </svg>
  );
}

/** Country / device / location chips of a keyword. */
export function KeywordChips({ country, device, location, deviceLabel, className }: { country: string; device: Device; location: string; deviceLabel: string; className?: string }) {
  const DeviceIcon = device === "mobile" ? Smartphone : Monitor;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1 text-[11px] text-muted", className)}>
      <span className="rounded border border-line px-1 font-mono font-medium" dir="ltr">
        {country}
      </span>
      <span className="inline-flex items-center rounded border border-line px-1 py-px" title={deviceLabel}>
        <DeviceIcon className="size-3" aria-hidden />
        <span className="sr-only">{deviceLabel}</span>
      </span>
      {location ? (
        <span className="inline-flex max-w-40 items-center gap-0.5 truncate rounded border border-line px-1">
          <MapPin className="size-3 shrink-0" aria-hidden />
          <bdi className="truncate">{location}</bdi>
        </span>
      ) : null}
    </span>
  );
}

export function TagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (!tags.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-primary-soft px-1.5 py-px text-[11px] font-medium text-primary-text">
          <bdi>{tag}</bdi>
        </span>
      ))}
    </span>
  );
}

/** A URL shown without the scheme, isolated left-to-right, truncated. */
export function UrlText({ url, domain, className, link = true }: { url: string | null; domain?: string; className?: string; link?: boolean }) {
  if (!url) return <span className="text-muted">–</span>;
  let text = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (domain && text.startsWith(domain)) text = text.slice(domain.length) || "/";
  const inner = (
    <bdi dir="ltr" className="truncate">
      {text}
    </bdi>
  );
  return link ? (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" title={url} className={cn("block truncate text-muted hover:text-primary", !className?.includes("max-w-") && "max-w-56", className)}>
      {inner}
    </a>
  ) : (
    <span title={url} className={cn("block truncate", !className?.includes("max-w-") && "max-w-56", className)}>
      {inner}
    </span>
  );
}

/** Coloured key for a series (legend / tooltip). */
export function SeriesKey({ index, children }: { index: number; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-0.5 w-3 rounded-full", SERIES_COLORS[index % SERIES_COLORS.length].bg)} aria-hidden />
      {children}
    </span>
  );
}
