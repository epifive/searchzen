import type { AlertEvent, AlertPayload } from "@/seo/types";

/**
 * Turns an AlertPayload into the title, summary and fields every channel shows.
 * Alerts are written in English (like the webhook payload), whatever the dashboard language.
 */

/** "2026-10-16 14:05 UTC" */
export function humanTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function humanNumber(value: number | string | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export const EVENT_COLORS: Record<AlertEvent, string> = {
  rank_entered_top: "#16a34a",
  rank_left_top: "#dc2626",
  rank_changed: "#0e7490",
  rank_url_lost: "#d97706",
  audit_finished: "#0e7490",
  audit_failed: "#dc2626",
  quota_warning: "#d97706",
  quota_reached: "#dc2626",
  test: "#1d5bd8",
};

const SUBJECT_PREFIX: Record<AlertEvent, string> = {
  rank_entered_top: "Ranking up",
  rank_left_top: "Ranking down",
  rank_changed: "Ranking change",
  rank_url_lost: "Target URL lost",
  audit_finished: "Site audit",
  audit_failed: "Site audit failed",
  quota_warning: "Usage 80%",
  quota_reached: "Usage limit reached",
  test: "Test",
};

/** The threshold of a top-N rank alert ("entered the top 3" → 3), from `data.top`; null for other alerts. */
export function alertTop(p: Pick<AlertPayload, "event" | "data">): number | null {
  if (p.event !== "rank_entered_top" && p.event !== "rank_left_top") return null;
  const top = Number(p.data.top);
  return Number.isInteger(top) && top > 0 ? top : null;
}

/**
 * The event as stored in alert_log: top-N rank alerts carry their threshold ("rank_entered_top:3")
 * so the project's alert history can name it. Older rows hold the bare event.
 */
export function alertLogEvent(p: Pick<AlertPayload, "event" | "data">): string {
  const top = alertTop(p);
  return top === null ? p.event : `${p.event}:${top}`;
}

/** Splits a stored alert_log event: "rank_entered_top:3" → { event: "rank_entered_top", top: 3 }. */
export function parseLogEvent(stored: string): { event: string; top: number | null } {
  const m = /^([a-z_]+):(\d{1,4})$/.exec(stored);
  return m ? { event: m[1], top: Number(m[2]) } : { event: stored, top: null };
}

/** True for events that need attention (red / "Attention" styling). */
export function isProblem(event: AlertEvent): boolean {
  return event === "rank_left_top" || event === "rank_url_lost" || event === "audit_failed" || event === "quota_reached";
}

export interface AlertText {
  /** One-line headline, e.g. "Ranking change in Acme Blog". */
  title: string;
  /** Email subject, e.g. "[Ranking change] Acme Blog". */
  subject: string;
  /** One or two sentences with the essentials. */
  summary: string;
  /** Label/value pairs shown as fields. */
  facts: Array<[string, string]>;
  color: string;
  /** Label of the link button ("Open dashboard"). */
  linkLabel: string;
}

/** Fact labels for well-known `data` keys (other keys are shown as they are). */
const FACT_LABELS: Record<string, string> = {
  keyword: "Keyword",
  position: "Position",
  previous: "Previous position",
  change: "Change",
  url: "Ranking URL",
  target: "Target URL",
  location: "Location",
  device: "Device",
  score: "Health score",
  previousScore: "Previous score",
  pages: "Pages crawled",
  critical: "Critical issues",
  warnings: "Warnings",
  newIssues: "New issues",
  fixedIssues: "Fixed issues",
  error: "Error",
  used: "Used",
  limit: "Plan limit",
  quota: "Limit",
};

export function describeAlert(p: AlertPayload, siteName: string): AlertText {
  const project = p.project?.name || "your project";
  const facts: Array<[string, string]> = [];
  if (p.project) facts.push(["Project", `${p.project.name} (${p.project.domain})`]);
  const top = alertTop(p);
  for (const [key, value] of Object.entries(p.data)) {
    // "top" is the rule's threshold, already part of the title.
    if (key === "example" || key === "top") continue;
    facts.push([FACT_LABELS[key] ?? key, typeof value === "number" ? humanNumber(value) : String(value)]);
  }
  let title: string;
  switch (p.event) {
    case "rank_entered_top":
      title = top ? `A keyword entered the top ${top} in ${project}` : `A keyword moved up in ${project}`;
      break;
    case "rank_left_top":
      title = top ? `A keyword left the top ${top} in ${project}` : `A keyword dropped in ${project}`;
      break;
    case "rank_changed":
      title = `Ranking change in ${project}`;
      break;
    case "rank_url_lost":
      title = `Target URL no longer ranks in ${project}`;
      break;
    case "audit_finished":
      title = `Site audit finished for ${project}`;
      break;
    case "audit_failed":
      title = `Site audit failed for ${project}`;
      break;
    case "quota_warning":
      title = "You have used 80% of your plan's limit";
      break;
    case "quota_reached":
      title = "You have reached your plan's limit";
      break;
    case "test":
      title = `Test alert from ${siteName}`;
      break;
  }
  return {
    title,
    subject: `[${top ? `${p.event === "rank_entered_top" ? "Entered" : "Left"} the top ${top}` : SUBJECT_PREFIX[p.event]}] ${p.event === "test" || !p.project ? siteName : p.project.name}`,
    summary: p.message,
    facts,
    color: EVENT_COLORS[p.event],
    linkLabel: "Open dashboard",
  };
}

/** Plain-text body used by email (and as a fallback elsewhere). */
export function alertPlainText(p: AlertPayload, siteName: string): string {
  const t = describeAlert(p, siteName);
  return [t.title, "", t.summary, "", ...t.facts.map(([k, v]) => `${k}: ${v}`), "", `${t.linkLabel}: ${p.url}`, "", `— ${siteName}`].join("\n");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface SendContext {
  siteName: string;
  /** Webhooks may point at private/internal addresses (env ALLOW_PRIVATE_WEBHOOKS=1). */
  allowPrivate: boolean;
  timeoutMs: number;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}
