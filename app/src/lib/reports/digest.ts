import "server-only";
import { getDb } from "@/lib/db";
import { formatNumber } from "@/lib/dash-format";
import { getGscTotals } from "@/lib/gsc/data";
import { emailTranslator } from "@/lib/i18n/email";
import type { Translator } from "@/lib/i18n/messages";
import { mailConfigured, sendMail } from "@/lib/mail";
import { getAuditDigest, getRankStats, topMovers } from "@/lib/overview";
import { periodDays } from "@/lib/periods";
import { getUserProjects } from "@/lib/projects";
import { getSettings, type Settings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { formatAveragePosition, formatChange, formatPosition } from "@/seo/format";
import { averagePosition } from "@/seo/normalize";
import { emailLayout, escapeHtml, figuresHtml, listHtml } from "./email";

/**
 * Weekly digest email: per project, keyword movers of the last 7 days, the site health score
 * and its change, and Search Console clicks against the week before. Sent on Mondays by the
 * "digest" job to every active owner of at least one active project who didn't opt out.
 */

const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface DigestProject {
  name: string;
  domain: string;
  url: string;
  keywords: number;
  up: number;
  down: number;
  averagePosition: number | null;
  movers: string[];
  score: number | null;
  scoreChange: number | null;
  clicks: number | null;
  clicksPrevious: number | null;
}

export async function collectDigest(userId: number, settings: Settings, t: Translator, locale: string): Promise<DigestProject[]> {
  const projects = (await getUserProjects(userId)).filter((p) => p.status === "active");
  if (!projects.length) return [];
  const days = periodDays(8);
  const stats = await getRankStats(
    projects.map((p) => p.id),
    days,
  );
  const db = await getDb();
  const out: DigestProject[] = [];
  for (const p of projects) {
    const s = stats.get(p.id);
    const kw = await db.selectFrom("keywords").select(["last_position", "last_checked_at"]).where("project_id", "=", p.id).where("status", "=", "active").execute();
    const audit = await getAuditDigest(p.id, 3);
    let clicks: number | null = null;
    let clicksPrevious: number | null = null;
    if (p.gscProperty) {
      const end = shift(days[days.length - 1], -2);
      clicks = (await getGscTotals(p.id, shift(end, -6), end)).clicks;
      clicksPrevious = (await getGscTotals(p.id, shift(end, -13), shift(end, -7))).clicks;
    }
    const movers = topMovers(s?.movers ?? [], 3);
    out.push({
      name: p.name,
      domain: p.domain,
      url: absoluteUrl(settings, `/dashboard/projects/${p.id}`),
      keywords: kw.length,
      up: s?.up ?? 0,
      down: s?.down ?? 0,
      averagePosition: averagePosition(kw.filter((k) => k.last_checked_at).map((k) => (k.last_position === null ? null : Number(k.last_position)))),
      movers: [...movers.up, ...movers.down].map(
        (m) => `${m.phrase}: ${formatPosition(m.previous, { locale })} → ${formatPosition(m.current, { locale })} (${formatChange(m.change, { new: t("seo.new"), lost: t("seo.lost") })})`,
      ),
      score: audit?.score ?? null,
      scoreChange: audit && audit.score !== null && audit.previousScore !== null ? audit.score - audit.previousScore : null,
      clicks,
      clicksPrevious,
    });
  }
  return out;
}

export function digestEmail(name: string, projects: DigestProject[], settings: Settings, t: Translator, locale: string): { subject: string; text: string; html: string } {
  const n = (v: number) => formatNumber(v, locale);
  const signed = (v: number) => (v > 0 ? `+${n(v)}` : n(v));
  const text: string[] = [t("digest.email.hello", { name }), "", t("digest.email.intro"), ""];
  let body = "";
  for (const p of projects) {
    const cells: Array<[string, string]> = [
      [t("digest.email.movement"), `▲ ${n(p.up)}  ▼ ${n(p.down)}`],
      [t("ov.kpi.avgPosition"), formatAveragePosition(p.averagePosition, locale)],
      [t("ov.kpi.health"), p.score === null ? "–" : `${p.score}${p.scoreChange ? ` (${signed(p.scoreChange)})` : ""}`],
    ];
    if (p.clicks !== null) cells.push([t("ov.kpi.clicks"), `${n(p.clicks)}${p.clicksPrevious !== null ? ` (${signed(p.clicks - p.clicksPrevious)})` : ""}`]);
    text.push(`${p.name} (${p.domain})`, ...cells.map(([k, v]) => `  ${k}: ${v}`), ...p.movers.map((m) => `  - ${m}`), `  ${p.url}`, "");
    body += `<div style="border-top:1px solid #dde3ec;padding-top:16px;margin-top:16px"><p style="margin:0 0 10px;font-size:16px;font-weight:bold"><a href="${escapeHtml(p.url)}" style="color:#141a24;text-decoration:none">${escapeHtml(p.name)}</a> <span style="font-weight:normal;color:#5b6575;font-size:13px">${escapeHtml(p.domain)}</span></p>${figuresHtml(cells)}${listHtml(t("ov.moversTitle"), p.movers)}</div>`;
  }
  const manage = absoluteUrl(settings, "/dashboard#digest");
  text.push(t("digest.email.manage", { url: manage }), "", `— ${settings.site_name}`);
  const subject = t("digest.email.subject", { site: settings.site_name });
  const html = emailLayout({
    color: settings.primary_color,
    logo: settings.logo && /^https?:\/\//.test(settings.logo) ? settings.logo : "",
    brand: settings.site_name,
    title: t("digest.email.title"),
    intro: t("digest.email.intro"),
    body,
    cta: { label: t("digest.email.cta"), url: absoluteUrl(settings, "/dashboard") },
    footer: `${escapeHtml(t("digest.email.why"))} <a href="${escapeHtml(manage)}" style="color:#5b6575">${escapeHtml(t("digest.email.unsubscribe"))}</a>`,
  });
  return { subject, text: text.join("\n"), html };
}

/** Send one user's digest. Returns false when there is nothing to send. Throws when sending fails. */
export async function sendDigest(user: { id: number; name: string; email: string }): Promise<boolean> {
  const settings = await getSettings();
  if (!mailConfigured(settings)) throw new Error("Email is not configured (Admin → Settings → Email).");
  const { t, locale } = await emailTranslator();
  const projects = await collectDigest(user.id, settings, t, locale);
  if (!projects.length) return false;
  const mail = digestEmail(user.name.split(" ")[0] || user.name, projects, settings, t, locale);
  await sendMail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
  return true;
}
