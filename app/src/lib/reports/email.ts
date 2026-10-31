import "server-only";
import { issueTitle } from "@/components/dashboard/overview-bits";
import { formatDay, formatNumber } from "@/lib/dash-format";
import { emailTranslator } from "@/lib/i18n/email";
import { plural, type Translator } from "@/lib/i18n/messages";
import { mailConfigured, sendMail } from "@/lib/mail";
import type { ProjectRecord } from "@/lib/projects";
import { getSettings, type Settings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { formatAveragePosition, formatChange, formatPosition } from "@/seo/format";
import { buildReport, type ReportData, type ReportPeriod } from "./data";

/**
 * Branded report emails (scheduled reports and "send a test now"): a short summary of the
 * report with a link to the full shared report. Written in the platform's default language.
 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface EmailBlock {
  /** Plain-text lines. */
  text: string[];
  /** HTML (already escaped). */
  html: string;
}

/** Full HTML email around `body`: accent bar, logo or name, card, footer. */
export function emailLayout(opts: { color: string; logo: string; brand: string; title: string; intro: string; body: string; cta?: { label: string; url: string }; footer: string; dir?: "ltr" | "rtl"; lang?: string }): string {
  const c = /^#[0-9a-f]{6}$/i.test(opts.color) ? opts.color : "#0e7490";
  const logo = opts.logo
    ? `<img src="${escapeHtml(opts.logo)}" alt="${escapeHtml(opts.brand)}" style="max-height:36px;max-width:180px;display:block">`
    : `<span style="font-size:18px;font-weight:bold;color:#18201d">${escapeHtml(opts.brand)}</span>`;
  const cta = opts.cta
    ? `<p style="margin:24px 0 0"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:${c};color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:8px">${escapeHtml(opts.cta.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="${escapeHtml(opts.lang ?? "en")}" dir="${opts.dir ?? "ltr"}"><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#141a24">
<div style="max-width:600px;margin:0 auto;padding:28px 16px">
<div style="height:4px;background:${c};border-radius:4px 4px 0 0"></div>
<div style="background:#ffffff;border:1px solid #dde3ec;border-top:0;border-radius:0 0 12px 12px;padding:24px">
<div style="margin-bottom:20px">${logo}</div>
<h1 style="font-size:20px;line-height:1.3;margin:0 0 6px">${escapeHtml(opts.title)}</h1>
<p style="margin:0 0 20px;color:#5b6575;font-size:14px">${escapeHtml(opts.intro)}</p>
${opts.body}${cta}
</div>
<p style="margin:16px 4px 0;color:#5b6575;font-size:12px;line-height:1.5">${opts.footer}</p>
</div></body></html>`;
}

/** A row of figure cells (label over value). */
export function figuresHtml(cells: Array<[string, string]>): string {
  const td = cells
    .map(
      ([label, value]) =>
        `<td style="padding:10px 12px;border:1px solid #dde3ec;vertical-align:top;width:${Math.floor(100 / cells.length)}%"><div style="font-size:11px;color:#5b6575;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(label)}</div><div style="font-size:20px;font-weight:bold;margin-top:4px">${escapeHtml(value)}</div></td>`,
    )
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 16px"><tr>${td}</tr></table>`;
}

export function listHtml(title: string, items: string[]): string {
  if (!items.length) return "";
  return `<p style="margin:16px 0 6px;font-weight:bold;font-size:14px">${escapeHtml(title)}</p><ul style="margin:0;padding-inline-start:18px;font-size:14px;line-height:1.6">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
}

function poweredFooter(data: ReportData, extra: string): string {
  const powered = data.brand.poweredBy ? ` · <a href="${escapeHtml(data.brand.poweredByUrl)}" style="color:#5b6575">${escapeHtml(data.brand.poweredBy)}</a>` : "";
  return `${escapeHtml(extra)}${powered}`;
}

/** Subject, text and HTML of a report email. */
export function reportEmail(data: ReportData, t: Translator, locale: string, link: string | null): { subject: string; text: string; html: string } {
  const r = data.rankings;
  const pct = (v: number) => `${formatNumber(v, locale, { maximumFractionDigits: 1 })}%`;
  const range = t("rep.view.range", { from: formatDay(data.from, locale), to: formatDay(data.to, locale) });
  const cells: Array<[string, string]> = [
    [t("ov.kpi.visibility"), pct(r.visibility)],
    [t("ov.kpi.avgPosition"), formatAveragePosition(r.averagePosition, locale)],
    [t("rep.view.top10"), formatNumber(r.top10, locale)],
    [t("ov.kpi.health"), data.audit?.score === null || data.audit?.score === undefined ? "–" : String(data.audit.score)],
  ];
  if (data.gsc) cells.push([t("ov.kpi.clicks"), formatNumber(data.gsc.totals.clicks, locale)]);
  const movers = [...r.movers]
    .filter((m) => m.change.kind !== "same")
    .sort((a, b) => Math.abs(b.change.delta ?? 50) - Math.abs(a.change.delta ?? 50))
    .slice(0, 5)
    .map((m) => `${m.phrase}: ${formatPosition(m.previous, { locale })} → ${formatPosition(m.current, { locale })} (${formatChange(m.change, { new: t("seo.new"), lost: t("seo.lost") })})`);
  const issues = (data.audit?.topIssues ?? []).slice(0, 3).map((i) => `${issueTitle(t, i.code)} (${plural(t, "rep.view.pages", i.count, { n: formatNumber(i.count, locale) })})`);
  const updown = t("rep.email.updown", { up: formatNumber(r.up, locale), down: formatNumber(r.down, locale) });
  const subject = t("rep.email.subject", { name: data.project.name, range });
  const intro = `${data.project.domain} · ${range}`;
  const text = [
    t("rep.email.title", { name: data.project.name }),
    intro,
    "",
    ...cells.map(([k, v]) => `${k}: ${v}`),
    updown,
    "",
    ...(movers.length ? [t("ov.moversTitle"), ...movers.map((m) => `- ${m}`), ""] : []),
    ...(issues.length ? [t("rep.view.topIssues"), ...issues.map((m) => `- ${m}`), ""] : []),
    link ? `${t("rep.email.cta")}: ${link}` : t("rep.email.noLink"),
    "",
    `— ${data.brand.company}${data.brand.poweredBy ? ` · ${data.brand.poweredBy}` : ""}`,
  ].join("\n");
  const body = `${figuresHtml(cells)}<p style="margin:0 0 8px;font-size:14px">${escapeHtml(updown)}</p>${listHtml(t("ov.moversTitle"), movers)}${listHtml(t("rep.view.topIssues"), issues)}${link ? "" : `<p style="margin:16px 0 0;font-size:13px;color:#5b6575">${escapeHtml(t("rep.email.noLink"))}</p>`}`;
  const html = emailLayout({
    color: data.brand.color,
    logo: data.brand.logo && /^https?:\/\//.test(data.brand.logo) ? data.brand.logo : "",
    brand: data.brand.company,
    title: t("rep.email.title", { name: data.project.name }),
    intro,
    body,
    cta: link ? { label: t("rep.email.cta"), url: link } : undefined,
    footer: poweredFooter(data, t("rep.view.footer", { company: data.brand.company })),
  });
  return { subject, text, html };
}

/** Absolute URL of an image path for emails ("/uploads/x.png" → "https://site/uploads/x.png"). */
function absolutize(settings: Settings, url: string): string {
  if (!url || /^https?:\/\//.test(url)) return url;
  return absoluteUrl(settings, url);
}

/** Build and send the report email of a project to `recipients`. Throws when email isn't configured or sending fails. */
export async function sendReportEmail(project: ProjectRecord, recipients: string[], days: ReportPeriod): Promise<void> {
  const settings = await getSettings();
  if (!mailConfigured(settings)) throw new Error("Email is not configured (Admin → Settings → Email).");
  if (!recipients.length) throw new Error("No recipients.");
  const [{ t, locale }, data] = await Promise.all([emailTranslator(), buildReport(project, days, { keywordLimit: 50 })]);
  data.brand.logo = absolutize(settings, data.brand.logo);
  const link = project.shareToken ? absoluteUrl(settings, `/r/${project.shareToken}?days=${days}`) : null;
  const mail = reportEmail(data, t, locale, link);
  await sendMail({ to: recipients.join(", "), subject: mail.subject, text: mail.text, html: mail.html });
}
