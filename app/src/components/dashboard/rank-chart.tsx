"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { SERIES_COLORS } from "./rank-kit";

export interface ChartSeries {
  id: string;
  label: string;
  /** Index into SERIES_COLORS (keeps a domain's colour stable across charts). */
  color: number;
  values: Array<number | null>;
}

/**
 * Line chart for rank data: one or more series over days, with a crosshair tooltip (pointer and
 * arrow keys) and a data table. `invert` draws position 1 at the top. One y-axis only.
 */
export function RankChart({
  days,
  series,
  locale,
  invert = false,
  kind,
  label,
  tableLabel,
  dayLabel,
  emptyText,
  height = 200,
}: {
  days: string[];
  series: ChartSeries[];
  locale: string;
  invert?: boolean;
  /** "position" (integer or 1 decimal, inverted axis) or "score" (0–100 with one decimal). */
  kind: "position" | "score";
  label: string;
  tableLabel: string;
  dayLabel: string;
  emptyText: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const tableId = useId();
  const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const n = days.length;

  const { lo, hi, ticks } = useMemo(() => {
    if (!values.length) return { lo: 0, hi: 1, ticks: [0, 1] };
    if (kind === "score") {
      const max = Math.max(...values);
      const top = max <= 5 ? 5 : max <= 10 ? 10 : max <= 25 ? 25 : max <= 50 ? 50 : 100;
      return { lo: 0, hi: top, ticks: [0, top / 2, top] };
    }
    const max = Math.max(...values);
    const top = max <= 10 ? 10 : max <= 20 ? 20 : max <= 50 ? 50 : 100;
    return { lo: 1, hi: top, ticks: [1, Math.round(top / 2), top] };
  }, [values, kind]);

  const fmt = (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return "–";
    const digits = kind === "score" || !Number.isInteger(v) ? 1 : 0;
    try {
      return v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      return v.toFixed(digits);
    }
  };
  const fmtDay = (day: string, long = false) => {
    const d = new Date(`${day}T00:00:00Z`);
    const o: Intl.DateTimeFormatOptions = long ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" };
    try {
      return d.toLocaleDateString(locale, o);
    } catch {
      return d.toLocaleDateString("en", o);
    }
  };

  // Coordinates in a 1000 × 1000 box (stretched; strokes don't scale).
  const xOf = (i: number) => (n <= 1 ? 500 : (i / (n - 1)) * 1000);
  const yOf = (v: number) => {
    const t = (v - lo) / (hi - lo || 1);
    return invert ? t * 1000 : 1000 - t * 1000;
  };
  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    const dots: Array<[number, number]> = [];
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      const clamped = Math.min(hi, Math.max(lo, v));
      d += `${pen ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(clamped).toFixed(1)}`;
      const prev = s.values[i - 1];
      const next = s.values[i + 1];
      if ((prev === null || prev === undefined) && (next === null || next === undefined)) dots.push([xOf(i), yOf(clamped)]);
      pen = true;
    });
    return { d, dots };
  });

  const indexAt = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || n === 0) return null;
    let t = (clientX - box.left) / box.width;
    if (getComputedStyle(boxRef.current!).direction === "rtl") t = 1 - t;
    return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => setHover(indexAt(e.clientX));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === fwd) setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === back) setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  if (!values.length) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-line text-sm text-muted" style={{ height }}>
        {emptyText}
      </div>
    );
  }

  const xPct = (i: number) => `${(n <= 1 ? 0.5 : i / (n - 1)) * 100}%`;
  const yPct = (v: number) => `${yOf(Math.min(hi, Math.max(lo, v))) / 10}%`;
  const tickIdx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];

  return (
    <figure aria-label={label} className="min-w-0">
      {series.length > 1 ? (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1.5">
              <span className={cn("h-0.5 w-3.5 rounded-full", SERIES_COLORS[s.color % SERIES_COLORS.length].bg)} aria-hidden />
              <bdi>{s.label}</bdi>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <div className="relative w-8 shrink-0 text-end text-[11px] text-muted tabular-nums" style={{ height }} aria-hidden>
          {ticks.map((v) => (
            <span key={v} className="absolute end-0 -translate-y-1/2" style={{ top: yPct(v) }}>
              {fmt(v)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            ref={boxRef}
            role="group"
            tabIndex={0}
            aria-label={label}
            aria-describedby={tableId}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            className="relative touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            style={{ height }}
          >
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {ticks.map((v) => (
                <div key={v} className={cn("absolute inset-x-0 border-t", v === ticks[ticks.length - 1] || v === ticks[0] ? "border-line" : "border-dashed border-line/70")} style={{ top: yPct(v) }} />
              ))}
            </div>
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible rtl:-scale-x-100" aria-hidden>
              {paths.map((p, i) => (
                <g key={series[i].id} className={SERIES_COLORS[series[i].color % SERIES_COLORS.length].stroke}>
                  <path d={p.d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  {p.dots.map(([x, y], j) => (
                    <path key={j} d={`M${x},${y}L${x},${y}`} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
              ))}
            </svg>
            {hover !== null ? (
              <>
                <div className="pointer-events-none absolute inset-y-0 w-px bg-ink/30" style={{ insetInlineStart: xPct(hover) }} aria-hidden />
                {series.map((s) =>
                  s.values[hover] !== null && s.values[hover] !== undefined ? (
                    <span
                      key={s.id}
                      className={cn("pointer-events-none absolute size-2.5 -translate-y-1/2 rounded-full ring-2 ring-surface ltr:-translate-x-1/2 rtl:translate-x-1/2", SERIES_COLORS[s.color % SERIES_COLORS.length].bg)}
                      style={{ insetInlineStart: xPct(hover), top: yPct(s.values[hover] as number) }}
                      aria-hidden
                    />
                  ) : null,
                )}
                <div
                  className={cn(
                    "pointer-events-none absolute top-1 z-10 w-max max-w-[16rem] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg",
                    hover > n / 2 ? "-translate-x-[calc(100%+8px)] rtl:translate-x-[calc(100%+8px)]" : "translate-x-2 rtl:-translate-x-2",
                  )}
                  style={{ insetInlineStart: xPct(hover) }}
                  role="status"
                >
                  <p className="font-medium">{fmtDay(days[hover], true)}</p>
                  <ul className="mt-1 space-y-0.5">
                    {series.map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        <span className={cn("h-0.5 w-3 shrink-0 rounded-full", SERIES_COLORS[s.color % SERIES_COLORS.length].bg)} aria-hidden />
                        <span className="font-semibold text-ink tabular-nums">{fmt(s.values[hover] ?? null)}</span>
                        {series.length > 1 ? (
                          <bdi className="truncate text-muted">{s.label}</bdi>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted" aria-hidden>
            {tickIdx.map((i) => (
              <span key={i}>{fmtDay(days[i])}</span>
            ))}
          </div>
        </div>
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted hover:text-ink">{tableLabel}</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line" id={tableId}>
          <table className="w-full text-start text-xs">
            <thead>
              <tr>
                <th scope="col" className="sticky top-0 bg-paper px-3 py-1.5 text-start font-medium text-muted">
                  {dayLabel}
                </th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className="sticky top-0 bg-paper px-3 py-1.5 text-end font-medium text-muted">
                    <bdi>{s.label}</bdi>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...days.keys()].reverse().map((i) => (
                <tr key={days[i]} className="border-t border-line">
                  <td className="px-3 py-1 whitespace-nowrap">{fmtDay(days[i], true)}</td>
                  {series.map((s) => (
                    <td key={s.id} className="px-3 py-1 text-end tabular-nums">
                      {fmt(s.values[i] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
