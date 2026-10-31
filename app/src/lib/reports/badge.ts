import "server-only";
import { getDb } from "@/lib/db";

/** SEO health badge: the latest finished audit's score of a shared project, as JSON or SVG. */

export async function latestScore(projectId: number): Promise<number | null> {
  const db = await getDb();
  const row = await db.selectFrom("audits").select("score").where("project_id", "=", projectId).where("status", "=", "done").orderBy("id", "desc").executeTakeFirst();
  return row?.score === null || row?.score === undefined ? null : Math.max(0, Math.min(100, Math.round(Number(row.score))));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Rough text width at 11px Verdana-like metrics (wide glyphs count more). */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[MWmw@%]/.test(ch) ? 10 : /[A-Z0-9#?]/.test(ch) ? 7.5 : /[ilj.,:;|!' ]/.test(ch) ? 3.5 : ch.charCodeAt(0) > 0x2e7f ? 11 : 6.5;
  return Math.ceil(w);
}

export function scoreColor(score: number | null): string {
  if (score === null) return "#94a3b8";
  return score >= 80 ? "#15803d" : score >= 50 ? "#b45309" : "#b91c1c";
}

/** A flat two-part badge: "<label> | <score>/100". */
export function badgeSvg(label: string, score: number | null, theme: "light" | "dark" = "light"): string {
  const left = label.slice(0, 40) || "SEO health";
  const right = score === null ? "–" : `${score}/100`;
  const lw = textWidth(left) + 16;
  const rw = textWidth(right) + 16;
  const w = lw + rw;
  const labelBg = theme === "dark" ? "#1e293b" : "#475569";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" viewBox="0 0 ${w} 20" role="img" aria-label="${esc(`${left}: ${right}`)}"><title>${esc(`${left}: ${right}`)}</title><clipPath id="r"><rect width="${w}" height="20" rx="4"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="${labelBg}"/><rect x="${lw}" width="${rw}" height="20" fill="${scoreColor(score)}"/></g><g fill="#fff" font-family="Verdana,DejaVu Sans,Arial,sans-serif" font-size="11" text-anchor="middle"><text x="${lw / 2}" y="14">${esc(left)}</text><text x="${lw + rw / 2}" y="14" font-weight="bold">${esc(right)}</text></g></svg>`;
}
