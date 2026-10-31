"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * Single-series time chart (one axis): visibility, clicks, impressions, CTR or position.
 * 2px line over a soft area, hairline grid, crosshair + tooltip on hover and with the arrow keys
 * (focus the chart). `invert` puts low values at the top (positions: 1 is best).
 */

/** percent: 0–1 ratio shown as %; share: a 0–100 value shown with %. */
export type ChartFormat = "number" | "percent" | "share" | "position" | "score";

export interface ChartPoint {
  day: string;
  value: number | null;
}

const W = 600;
const H = 200;

function fmt(value: number | null, format: ChartFormat, locale: string): string {
  if (value === null || !Number.isFinite(value)) return "–";
  try {
    if (format === "percent") return (value * 100).toLocaleString(locale, { maximumFractionDigits: 1 }) + "%";
    if (format === "share") return value.toLocaleString(locale, { maximumFractionDigits: 1 }) + "%";
    if (format === "position" || format === "score") return value.toLocaleString(locale, { maximumFractionDigits: 1 });
    return Math.round(value).toLocaleString(locale);
  } catch {
    return String(value);
  }
}

function fmtDay(day: string, locale: string, long = false): string {
  const d = new Date(`${day}T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions = long ? { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" };
  try {
    return d.toLocaleDateString(locale, options);
  } catch {
    return d.toLocaleDateString("en", options);
  }
}

/** A "nice" axis maximum (1, 2, 2.5, 5 × 10^n). */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const m = 10 ** Math.floor(Math.log10(v));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * m >= v) return f * m;
  return 10 * m;
}

export function LineChart({
  points,
  format,
  locale,
  label,
  invert = false,
  height = 200,
  fixedMax,
  emptyText,
}: {
  points: ChartPoint[];
  format: ChartFormat;
  locale: string;
  /** Series name: accessible label and tooltip text. */
  label: string;
  invert?: boolean;
  height?: number;
  /** Fixed axis maximum (e.g. 100 for visibility). */
  fixedMax?: number;
  emptyText?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const values = points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
  if (!points.length || !values.length) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-line text-sm text-muted" style={{ height }}>
        {emptyText ?? "–"}
      </div>
    );
  }
  let min = 0;
  let max = fixedMax ?? niceCeil(Math.max(...values));
  if (invert) {
    // Positions: from 1 (top) to a nice worst position (bottom).
    min = 1;
    max = Math.max(10, niceCeil(Math.max(...values)));
  }
  const n = points.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => {
    const t = (v - min) / (max - min || 1);
    return invert ? t * H : H - t * H;
  };
  // Line segments break where a value is missing.
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.value === null || !Number.isFinite(p.value)) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  if (current) segments.push(current);
  // A value with no neighbour (e.g. the only day with data) has no line to draw: show it as a dot.
  const valid = (i: number) => i >= 0 && i < n && points[i].value !== null && Number.isFinite(points[i].value);
  const lone = points.map((_, i) => i).filter((i) => valid(i) && !valid(i - 1) && !valid(i + 1));
  const area = !invert
    ? segments.map((s) => {
        const xs = [...s.matchAll(/[ML]([\d.]+),/g)].map((m) => m[1]);
        return `${s}L${xs[xs.length - 1]},${H}L${xs[0]},${H}Z`;
      })
    : [];
  const ticks = invert ? [min, Math.round((min + max) / 2), max] : [max, max / 2, 0];
  const tickIndexes = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];

  const pick = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    setActive(Math.round(ratio * (n - 1)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(n - 1, Math.max(0, (a ?? (step > 0 ? -1 : n)) + step)));
    } else if (e.key === "Escape") setActive(null);
  };
  const a = active !== null ? points[active] : null;
  const left = active !== null ? (n === 1 ? 50 : (active / (n - 1)) * 100) : 0;

  return (
    <figure aria-label={label} className="select-none" dir="ltr">
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-end text-[11px] text-muted tabular-nums" style={{ height }} aria-hidden>
          {ticks.map((v, i) => (
            <span key={i} className={i === 0 ? "-translate-y-1/2" : i === ticks.length - 1 ? "translate-y-1/2" : undefined}>
              {fmt(v, format === "score" ? "position" : format, locale)}
            </span>
          ))}
        </div>
        <div
          ref={ref}
          className="relative min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          style={{ height }}
          tabIndex={0}
          role="img"
          aria-describedby={`${id}-desc`}
          onPointerMove={(e: PointerEvent<HTMLDivElement>) => pick(e.clientX)}
          onPointerDown={(e: PointerEvent<HTMLDivElement>) => pick(e.clientX)}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
            <div className="border-t border-line" />
            <div className="border-t border-line" />
            <div className="border-t border-line" />
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {area.map((d, i) => (
              <path key={`a${i}`} d={d} fill="var(--primary)" fillOpacity={0.1} stroke="none" />
            ))}
            {segments.map((d, i) => (
              <path key={`l${i}`} d={d} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {lone.map((i) => (
            <div
              key={`p${i}`}
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
              style={{ left: `${n === 1 ? 50 : (i / (n - 1)) * 100}%`, top: `${(y(points[i].value as number) / H) * 100}%` }}
              aria-hidden
            />
          ))}
          {a ? (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-ink/40" style={{ left: `${left}%` }} aria-hidden />
              {a.value !== null ? (
                <div
                  className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-primary"
                  style={{ left: `${left}%`, top: `${(y(a.value) / H) * 100}%` }}
                  aria-hidden
                />
              ) : null}
              <div
                className={cn(
                  "pointer-events-none absolute top-0 z-10 w-max max-w-48 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg",
                  left > 60 ? "-translate-x-[calc(100%+10px)]" : "translate-x-[10px]",
                )}
                style={{ left: `${left}%` }}
                role="status"
              >
                <p className="text-sm font-semibold text-ink tabular-nums">{fmt(a.value, format, locale)}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-muted">
                  <span className="inline-block h-0.5 w-3 rounded bg-primary" aria-hidden />
                  <span dir="auto">{label}</span>
                </p>
                <p className="mt-0.5 text-muted">{fmtDay(a.day, locale, true)}</p>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex justify-between ps-10 text-[11px] text-muted" aria-hidden>
        {tickIndexes.map((i) => (
          <span key={i}>{fmtDay(points[i].day, locale)}</span>
        ))}
      </div>
      <p id={`${id}-desc`} className="sr-only">
        {label}: {fmtDay(points[0].day, locale)} {fmt(points[0].value, format, locale)} → {fmtDay(points[n - 1].day, locale)} {fmt(points[n - 1].value, format, locale)}
      </p>
    </figure>
  );
}

/** Tiny trend line for cards (no axes, no interaction). */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <div className={cn("h-10 border-b border-dashed border-line", className)} role="img" aria-label={label} />;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(36 - ((v - min) / (max - min || 1)) * 32).toFixed(2)}`);
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={cn("h-10 w-full", className)} role="img" aria-label={label}>
      <path d={`M${pts.join("L")}L100,40L0,40Z`} fill="var(--primary)" fillOpacity={0.08} />
      <path d={`M${pts.join("L")}`} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
