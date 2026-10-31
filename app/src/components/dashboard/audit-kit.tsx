import type { ReactNode } from "react";
import Link from "next/link";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { LinkTabs } from "@/components/dashboard/ui";
import { Badge } from "@/components/ui/badge";
import { MESSAGES, type MessageKey, type Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { scoreGrade } from "@/seo/normalize";
import type { AuditStatus, IssueCategory, Severity } from "@/seo/types";

/** Server-safe building blocks of the site audit pages (no client JS). */

export const auditBase = (projectId: number) => `/dashboard/projects/${projectId}/audit`;

/** "?audit=12" (or "") to keep the selected audit across the audit pages. */
export const auditQuery = (auditId: number | null | undefined, latestId: number | null | undefined) => (auditId && auditId !== latestId ? `?audit=${auditId}` : "");

/** Overview / Issues / Pages tabs. */
export function AuditNav({ projectId, active, query, t }: { projectId: number; active: "overview" | "issues" | "pages"; query: string; t: Translator }) {
  const base = auditBase(projectId);
  return (
    <LinkTabs
      label={t("audit.nav.label")}
      items={[
        { href: `${base}${query}`, label: t("audit.nav.overview"), active: active === "overview" },
        { href: `${base}/issues${query}`, label: t("audit.nav.issues"), active: active === "issues" },
        { href: `${base}/pages${query}`, label: t("audit.nav.pages"), active: active === "pages" },
      ]}
    />
  );
}

const hasKey = (key: string): key is MessageKey => key in MESSAGES;

/** Title of an issue code (the code itself for codes this version doesn't know). */
export function issueTitle(t: Translator, code: string): string {
  const key = `audit.issue.${code}`;
  return hasKey(key) ? t(key) : code;
}

export function issueText(t: Translator, code: string, part: "help" | "fix"): string {
  const key = `audit.issue.${code}.${part}`;
  return hasKey(key) ? t(key) : "";
}

const SEVERITY_TONE: Record<Severity, "danger" | "warning" | "neutral"> = { critical: "danger", warning: "warning", notice: "neutral" };
const SEVERITY_ICON: Record<Severity, typeof CircleAlert> = { critical: CircleAlert, warning: TriangleAlert, notice: Info };

export function SeverityBadge({ severity, t, className }: { severity: Severity; t: Translator; className?: string }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <Badge tone={SEVERITY_TONE[severity]} className={className}>
      <Icon className="size-3" aria-hidden />
      {t(`seo.severity.${severity}`)}
    </Badge>
  );
}

/** Dot colour of a severity (bars, legends). */
export const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-red-500 dark:bg-red-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  notice: "bg-sky-500 dark:bg-sky-400",
};

export function AuditStatusBadge({ status, t }: { status: AuditStatus; t: Translator }) {
  const tone = status === "done" ? "success" : status === "failed" ? "danger" : status === "cancelled" ? "neutral" : "primary";
  return <Badge tone={tone}>{t(`audit.status.${status}`)}</Badge>;
}

const GRADE_STROKE = { good: "stroke-emerald-500", fair: "stroke-amber-500", poor: "stroke-red-500", none: "stroke-line" } as const;
const GRADE_TEXT = { good: "text-emerald-700 dark:text-emerald-400", fair: "text-amber-700 dark:text-amber-400", poor: "text-red-700 dark:text-red-400", none: "text-muted" } as const;

/** Ring gauge of a health score (0–100) with its grade. */
export function ScoreGauge({ score, t, size = 132 }: { score: number | null; t: Translator; size?: number }) {
  const grade = scoreGrade(score);
  const r = 52;
  const c = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, score ?? 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-line/70" />
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round" className={GRADE_STROKE[grade]} strokeDasharray={`${(value / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="font-display text-3xl leading-none font-bold tabular-nums" role="img" aria-label={`${t("audit.score")}: ${score ?? "–"}/100`}>
            <bdi>{score ?? "–"}</bdi>
          </p>
          {grade !== "none" ? <p className={cn("mt-1 text-xs font-semibold", GRADE_TEXT[grade])}>{t(`audit.grade.${grade}`)}</p> : null}
        </div>
      </div>
    </div>
  );
}

/** Score change against the previous audit: "+5" green, "−3" red. */
export function ScoreChange({ change, t }: { change: number | null; t: Translator }) {
  if (change === null) return <span dir="auto" className="text-sm text-muted">{t("audit.firstAudit")}</span>;
  const text = change > 0 ? `+${change}` : change < 0 ? `−${Math.abs(change)}` : "±0";
  return (
    <span dir="auto" className={cn("text-sm font-medium", change > 0 ? "text-emerald-700 dark:text-emerald-400" : change < 0 ? "text-red-700 dark:text-red-400" : "text-muted")}>
      {t("audit.scoreChange", { change: text })}
    </span>
  );
}

/** Horizontal bars of issue counts per category, split by severity. */
export function CategoryBars({ rows, t, locale }: { rows: Array<{ category: IssueCategory; counts: Record<Severity, number> }>; t: Translator; locale: string }) {
  const max = Math.max(1, ...rows.map((r) => r.counts.critical + r.counts.warning + r.counts.notice));
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const total = r.counts.critical + r.counts.warning + r.counts.notice;
        return (
          <li key={r.category}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{t(`audit.category.${r.category}`)}</span>
              <bdi className="text-muted tabular-nums">{total.toLocaleString(locale)}</bdi>
            </div>
            <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-line/60" aria-hidden>
              {(["critical", "warning", "notice"] as const).map((s) =>
                r.counts[s] ? <div key={s} className={SEVERITY_DOT[s]} style={{ width: `${(r.counts[s] / max) * 100}%` }} /> : null,
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const DETAIL_KEYS = ["status", "error", "hops", "target", "source", "count", "value", "url", "length", "words", "total", "bytes", "ms", "missing", "depth", "urls"] as const;

function detailValue(key: string, value: string | number | boolean, locale: string): ReactNode {
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    return (
      <bdi dir="ltr" className="break-all">
        {value}
      </bdi>
    );
  }
  if (typeof value === "number") {
    if (key === "bytes") return <bdi>{`${(value / 1024).toLocaleString(locale, { maximumFractionDigits: 0 })} KB`}</bdi>;
    if (key === "ms") return <bdi>{`${value.toLocaleString(locale)} ms`}</bdi>;
    return <bdi className="tabular-nums">{value.toLocaleString(locale)}</bdi>;
  }
  return <bdi dir="auto">{String(value)}</bdi>;
}

/** The facts stored with an issue ("Status 404 · Target https://…"). */
export function IssueDetails({ details, t, locale }: { details: Record<string, string | number | boolean>; t: Translator; locale: string }) {
  const entries = DETAIL_KEYS.filter((k) => details[k] !== undefined && details[k] !== "");
  if (!entries.length) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
      {entries.map((k) => (
        <span key={k} className="min-w-0">
          {t(`audit.detail.${k}`)}: <span className="text-ink">{detailValue(k, details[k], locale)}</span>
        </span>
      ))}
    </span>
  );
}

/** A URL shown left-to-right inside any text direction, shortened to its path on the audited origin ("https://www.example.com"). */
export function UrlText({ url, origin, className }: { url: string; origin?: string; className?: string }) {
  let text = url;
  if (origin) {
    try {
      const u = new URL(url);
      if (u.origin === origin) text = `${u.pathname}${u.search}`;
    } catch {
      // keep the full URL
    }
  }
  return (
    <bdi dir="ltr" className={cn("break-all", className)} title={url}>
      {text}
    </bdi>
  );
}

/** Status code chip. */
export function HttpStatus({ status, t }: { status: number | null; t: Translator }) {
  if (status === null) return <Badge tone="danger">{t("audit.pages.error")}</Badge>;
  const tone = status >= 500 || status >= 400 ? "danger" : status >= 300 ? "warning" : "success";
  return (
    <Badge tone={tone} className="tabular-nums">
      {status}
    </Badge>
  );
}

/** A label / value row of the page detail lists. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("font-medium text-primary hover:underline", className)}>
      {children}
    </Link>
  );
}
