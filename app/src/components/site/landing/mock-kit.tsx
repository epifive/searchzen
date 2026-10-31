import type { ReactNode } from "react";
import { FEATURE_ICONS } from "@/components/dashboard/rank-kit";
import { cn } from "@/lib/utils";
import type { SerpFeature } from "@/seo/types";
import { num } from "./format";

/** Building blocks of the landing page illustrations: plain HTML/SVG, no JavaScript. */

/** Window chrome around an app illustration: traffic lights, address and extras on the end side. */
export function WindowFrame({ address, extra, children, className }: { address: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_100px_-40px_rgba(8,51,68,0.55)] ring-1 ring-black/[0.02] dark:shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-line bg-paper/70 px-4 py-2.5">
        <span aria-hidden className="flex shrink-0 gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span dir="ltr" className="min-w-0 truncate font-display text-sm font-semibold">
          {address}
        </span>
        {extra ? <span className="ms-auto flex shrink-0 items-center gap-2">{extra}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** A Google position in a pill: green for the top 3, brand colour for the top 10, grey below. */
export function PositionPill({ position, locale, className }: { position: number; locale: string; className?: string }) {
  return (
    <bdi
      className={cn(
        "inline-grid h-6 min-w-7 place-items-center rounded-md px-1.5 font-display text-[13px] font-bold tabular-nums",
        position <= 3
          ? "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 ring-inset dark:text-emerald-300"
          : position <= 10
            ? "bg-primary-soft text-primary-text ring-1 ring-primary-line ring-inset"
            : "bg-line/60 text-muted",
        className,
      )}
    >
      {num(position, locale)}
    </bdi>
  );
}

/** "▲ 5" in green or "▼ 2" in red. */
export function ChangeText({ delta, locale, className }: { delta: number; locale: string; className?: string }) {
  if (!delta) return <span className={cn("text-xs text-muted", className)}>0</span>;
  return (
    <bdi className={cn("text-xs font-semibold whitespace-nowrap tabular-nums", delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400", className)}>
      {delta > 0 ? "▲" : "▼"} {num(Math.abs(delta), locale)}
    </bdi>
  );
}

/** SERP feature icons in small tiles. */
export function FeatureTiles({ features, className }: { features: SerpFeature[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {features.map((f) => {
        const Icon = FEATURE_ICONS[f];
        return (
          <span key={f} className="grid size-5 place-items-center rounded bg-paper text-muted ring-1 ring-line ring-inset">
            <Icon className="size-3" aria-hidden />
          </span>
        );
      })}
    </span>
  );
}

/** Position sparkline: rank 1 draws at the top. */
export function TrendLine({ points, className, width = 64, height = 22 }: { points: number[]; className?: string; width?: number; height?: number }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(3, max - min);
  const x = (i: number) => (i / (points.length - 1)) * (width - 4) + 2;
  const y = (p: number) => 3 + ((p - min) / span) * (height - 6);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const rising = last <= points[0];
  return (
    <svg aria-hidden viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={cn("overflow-visible rtl:-scale-x-100", className)}>
      <path
        d={d}
        pathLength={1}
        fill="none"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("animate-[sz-draw_1.4s_ease-out_0.4s_both] [stroke-dasharray:1] motion-reduce:animate-none", rising ? "stroke-primary" : "stroke-red-500/80")}
      />
      <circle cx={x(points.length - 1)} cy={y(last)} r={2.5} className={rising ? "fill-primary" : "fill-red-500/80"} />
    </svg>
  );
}

/** Health score colour by grade (same thresholds as the dashboard: 80+ good, 50+ fair). */
export function scoreColor(score: number): { stroke: string; text: string } {
  if (score >= 80) return { stroke: "stroke-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 50) return { stroke: "stroke-amber-500", text: "text-amber-600 dark:text-amber-400" };
  return { stroke: "stroke-red-500", text: "text-red-600 dark:text-red-400" };
}

/** Circular health score gauge whose arc draws in once. */
export function ScoreRing({ score, label, size = 120, className }: { score: number; label?: string; size?: number; className?: string }) {
  const r = 50;
  const value = Math.max(0, Math.min(0.999, score / 100));
  const angle = value * 2 * Math.PI;
  const end = [60 + r * Math.sin(angle), 60 - r * Math.cos(angle)];
  const arc = `M60 ${60 - r} A${r} ${r} 0 ${value > 0.5 ? 1 : 0} 1 ${end[0].toFixed(2)} ${end[1].toFixed(2)}`;
  const tone = scoreColor(score);
  return (
    <span className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg aria-hidden viewBox="0 0 120 120" className="absolute inset-0 size-full">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="11" className="stroke-line/70" />
        <path
          d={arc}
          pathLength={1}
          fill="none"
          strokeWidth="11"
          strokeLinecap="round"
          className={cn(tone.stroke, "animate-[sz-draw_1.6s_cubic-bezier(0.3,0.7,0.2,1)_0.5s_both] [stroke-dasharray:1] motion-reduce:animate-none")}
        />
      </svg>
      <span className="relative text-center leading-none">
        <bdi className="block font-display font-bold tracking-tight tabular-nums" style={{ fontSize: size * 0.28 }}>
          {score}
        </bdi>
        {label ? <span className={cn("mt-1 block text-[10px] font-semibold", tone.text)}>{label}</span> : null}
      </span>
    </span>
  );
}

/** Small brand tile used for providers and alert channels. */
export function Tile({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg font-display text-[12px] font-bold text-white", className)}>{children}</span>;
}

/** Severity dot colours of the site audit (critical / warning / notice). */
export const SEVERITY_DOT = {
  critical: "bg-red-500 dark:bg-red-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  notice: "bg-sky-500 dark:bg-sky-400",
} as const;
