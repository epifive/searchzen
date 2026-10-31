/** Display helpers shared by server and client components (dashboard, reports, emails). Dependency-free. */

import { COUNTRIES, LANGUAGES, type PositionChange } from "./normalize";

/** Translator shape accepted by these helpers (server getT() and client useT() both fit). */
type LimitT = (key: "pricing.unlimited") => string;

/** 0 → "Unlimited", otherwise a grouped number. */
export function formatLimit(value: number, t: LimitT, locale?: string): string {
  return value ? value.toLocaleString(locale) : t("pricing.unlimited");
}

/** Shown for keywords that are not ranked (or not checked yet). */
export const NOT_RANKED = "–";

/**
 * A position for tables and reports: 7 → "7"; null → "–" (not ranked within the checked depth,
 * or `${depth}+` when `depth` is given, e.g. "20+"); anything beyond 100 → "100+".
 */
export function formatPosition(position: number | null | undefined, options: { depth?: number; locale?: string } = {}): string {
  if (position === null || position === undefined || !Number.isFinite(position) || position < 1) {
    return options.depth ? `${options.depth}+` : NOT_RANKED;
  }
  if (position > 100) return "100+";
  const n = Math.round(position);
  try {
    return n.toLocaleString(options.locale);
  } catch {
    return String(n);
  }
}

/** Average position with one decimal ("6.4"), "–" when null. */
export function formatAveragePosition(value: number | null | undefined, locale?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_RANKED;
  try {
    return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  } catch {
    return value.toFixed(1);
  }
}

/** Arrow for a change: ▲ up, ▼ down, ● new, ✕ lost, "" otherwise. */
export function changeArrow(change: PositionChange): string {
  switch (change.kind) {
    case "up":
      return "▲";
    case "down":
      return "▼";
    case "new":
      return "●";
    case "lost":
      return "✕";
    default:
      return "";
  }
}

/**
 * Compact change text for tables and plain-text emails: "▲ 8", "▼ 3", "0", "new", "lost" or ""
 * (not ranked both times). Pass translated `labels` for "new" / "lost" in the interface.
 */
export function formatChange(change: PositionChange, labels: { new: string; lost: string } = { new: "new", lost: "lost" }): string {
  switch (change.kind) {
    case "up":
    case "down":
      return `${changeArrow(change)} ${Math.abs(change.delta ?? 0)}`;
    case "same":
      return "0";
    case "new":
      return labels.new;
    case "lost":
      return labels.lost;
    default:
      return "";
  }
}

/** Signed change for CSV / webhooks: "+8", "-3", "0", "" when not comparable. */
export function signedChange(change: PositionChange): string {
  if (change.delta === null) return "";
  return change.delta > 0 ? `+${change.delta}` : String(change.delta);
}

/** Tailwind text colour class of a change (green up, red down). */
export function changeTone(change: PositionChange): string {
  switch (change.kind) {
    case "up":
    case "new":
      return "text-emerald-600 dark:text-emerald-400";
    case "down":
    case "lost":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-muted";
  }
}

/** Tailwind classes of a health score badge (good / fair / poor). */
export function scoreTone(score: number | null | undefined): string {
  if (score === null || score === undefined) return "bg-line/70 text-muted";
  if (score >= 80) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (score >= 50) return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
}

const plainSymbols = new Map<string, string>();

/**
 * The sign English shows for a currency when it is a plain, unambiguous sign ($, €, £, ¥, ₹ …),
 * else "". CA$, A$ or CN¥ stay as they are, and so do letter codes (AED).
 */
function plainSymbol(currency: string): string {
  const code = currency.toUpperCase();
  let symbol = plainSymbols.get(code);
  if (symbol === undefined) {
    try {
      const sign = (currencyDisplay: "narrowSymbol" | "symbol") =>
        new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay }).formatToParts(1).find((p) => p.type === "currency")?.value ?? "";
      const narrow = sign("narrowSymbol");
      symbol = narrow === sign("symbol") && !/[A-Za-z]/.test(narrow) ? narrow : "";
    } catch {
      symbol = "";
    }
    plainSymbols.set(code, symbol);
  }
  return symbol;
}

/**
 * Intl currency formatting in the reader's language with the plain sign where there is one
 * (some languages spell even common signs out, "US$" in Arabic). Throws like Intl.NumberFormat
 * on an unknown currency.
 */
export function formatCurrency(value: number, currency: string, locale: string, options: Intl.NumberFormatOptions = {}): string {
  const symbol = plainSymbol(currency);
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency, ...(symbol ? { currencyDisplay: "narrowSymbol" } : {}), ...options });
  if (!symbol) return nf.format(value);
  return nf
    .formatToParts(value)
    .map((p) => (p.type === "currency" ? symbol : p.value))
    .join("");
}

function displayNames(locale: string, type: "region" | "language"): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale, "en"], { type });
  } catch {
    return null;
  }
}

/** A country's name in the reader's language (falls back to the English name, then the code). */
export function localCountryName(code: string, locale: string): string {
  return displayNames(locale, "region")?.of(code) ?? COUNTRIES.find(([c]) => c === code)?.[1] ?? code;
}

/** Country options for selects, named in the reader's language and sorted by that name. */
export function countryOptions(locale: string): Array<{ value: string; label: string }> {
  const names = displayNames(locale, "region");
  return COUNTRIES.map(([code, name]) => ({ value: code, label: names?.of(code) ?? name })).sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** Language options (Google hl) for selects, named in the reader's language and sorted by that name. */
export function languageOptions(locale: string): Array<{ value: string; label: string }> {
  const names = displayNames(locale, "language");
  return LANGUAGES.map(([code, name]) => ({ value: code, label: names?.of(code) ?? name })).sort((a, b) => a.label.localeCompare(b.label, locale));
}
