import type { AuditCheck, IssueCategory, Severity } from "@/seo/types";
import { CONTENT_CHECKS } from "./content";
import { INDEXABILITY_CHECKS } from "./indexability";
import { LINK_CHECKS } from "./links";
import { PERFORMANCE_CHECKS, SOCIAL_CHECKS, TECHNICAL_CHECKS } from "./technical";

/**
 * The audit check registry. Each check has a stable code (stored in audit_issues.code), a
 * severity, a category and the message keys audit.issue.<code> (title), audit.issue.<code>.help
 * (what it means) and audit.issue.<code>.fix (how to fix it). Page checks run on every crawled
 * page, site checks once per audit (robots.txt, sitemap, HTTPS, favicon).
 * Dependency-free: safe in server and client components.
 */
export const AUDIT_CHECKS: AuditCheck[] = [...INDEXABILITY_CHECKS, ...CONTENT_CHECKS, ...LINK_CHECKS, ...PERFORMANCE_CHECKS, ...TECHNICAL_CHECKS, ...SOCIAL_CHECKS];

const BY_CODE = new Map(AUDIT_CHECKS.map((c) => [c.code, c]));

export function getCheck(code: string): AuditCheck | undefined {
  return BY_CODE.get(code);
}

/** Codes of the site-wide checks (they count once in the health score). */
export const SITE_CHECK_CODES = new Set(AUDIT_CHECKS.filter((c) => c.testSite).map((c) => c.code));

/** Severity of a code ("notice" for unknown codes, e.g. from a newer version). */
export function severityOf(code: string): Severity {
  return BY_CODE.get(code)?.severity ?? "notice";
}

export function categoryOf(code: string): IssueCategory {
  return BY_CODE.get(code)?.category ?? "technical";
}

/** Sort order of the issues list: critical first, then by the registry order. */
export function compareCodes(a: string, b: string): number {
  const rank: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 };
  const ra = rank[severityOf(a)];
  const rb = rank[severityOf(b)];
  if (ra !== rb) return ra - rb;
  return AUDIT_CHECKS.findIndex((c) => c.code === a) - AUDIT_CHECKS.findIndex((c) => c.code === b);
}
