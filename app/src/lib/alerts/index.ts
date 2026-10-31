import "server-only";
import { getDb } from "@/lib/db";
import { getActiveChannels, getUserChannels, logAlert, type ChannelRecord } from "@/lib/channels";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import type { AlertEvent, AlertPayload, ChannelConfigByType } from "@/seo/types";
import { sendDiscord } from "./discord";
import { sendEmail } from "./email";
import { alertLogEvent, type SendContext, type SendResult } from "./format";
import { sendSlack } from "./slack";
import { sendTeams } from "./teams";
import { sendTelegram } from "./telegram";
import { sendWebhook } from "./webhook";

export type { SendResult } from "./format";

const TIMEOUT_MS = 8_000;

/** Dashboard link for a project (also the `url` field of its alerts). */
export function projectDashboardPath(projectId: number): string {
  return `/dashboard/projects/${projectId}`;
}

/**
 * Webhooks to private / internal addresses (n8n on the LAN, localhost…) are refused unless
 * the server sets ALLOW_PRIVATE_WEBHOOKS=1. Slack, Discord, Teams and Telegram are public anyway.
 */
function allowPrivateWebhooks(): boolean {
  const v = process.env.ALLOW_PRIVATE_WEBHOOKS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function sendContext(): Promise<SendContext> {
  const settings = await getSettings();
  return { siteName: settings.site_name, allowPrivate: allowPrivateWebhooks(), timeoutMs: TIMEOUT_MS };
}

function withTimeout(work: Promise<SendResult>, ms: number): Promise<SendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<SendResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: `Timed out after ${Math.round(ms / 1000)} s` }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Send one alert to one channel. Never throws. */
export async function sendAlert(channel: ChannelRecord, payload: AlertPayload, ctx?: SendContext): Promise<SendResult> {
  const context = ctx ?? (await sendContext());
  const work = (async (): Promise<SendResult> => {
    switch (channel.type) {
      case "email":
        return sendEmail(channel.config as ChannelConfigByType["email"], payload, context);
      case "webhook":
        return sendWebhook(channel.config as ChannelConfigByType["webhook"], payload, context);
      case "slack":
        return sendSlack(channel.config as ChannelConfigByType["slack"], payload, context);
      case "discord":
        return sendDiscord(channel.config as ChannelConfigByType["discord"], payload, context);
      case "teams":
        return sendTeams(channel.config as ChannelConfigByType["teams"], payload, context);
      case "telegram":
        return sendTelegram(channel.config as ChannelConfigByType["telegram"], payload, context);
    }
    return { ok: false, error: "Unknown channel type" };
  })().catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Sending failed" }));
  return withTimeout(work, context.timeoutMs + 500);
}

/** Build the payload every channel receives (also the JSON body of webhooks). */
export async function buildAlertPayload(
  project: { id: number; name: string; domain: string } | null,
  event: AlertEvent,
  message: string,
  data: Record<string, number | string> = {},
): Promise<AlertPayload> {
  const settings = await getSettings();
  return {
    event,
    project: project ? { id: project.id, name: project.name, domain: project.domain } : null,
    message,
    data,
    url: absoluteUrl(settings, project ? projectDashboardPath(project.id) : "/dashboard"),
    sentAt: new Date().toISOString(),
  };
}

/**
 * Send `payload` to the active channels among `channelIds` that belong to the project's owner
 * (or to `ownerId` when given), in parallel (8 s timeout each), and log every attempt to
 * alert_log. When no channel is left, one failed row is logged so the alert still shows in the
 * project's history. Never throws.
 */
export async function notifyChannels(
  channelIds: number[],
  payload: AlertPayload,
  projectId: number | null,
  ownerId?: number,
): Promise<{ sent: number; failed: number }> {
  try {
    let owner = ownerId;
    if (owner === undefined && projectId) {
      const db = await getDb();
      owner = (await db.selectFrom("projects").select("user_id").where("id", "=", projectId).executeTakeFirst())?.user_id;
    }
    const channels = owner ? await getActiveChannels(channelIds, owner) : [];
    if (!channels.length) {
      await logAlert({ projectId, channelId: null, event: alertLogEvent(payload), ok: false, error: "No active alert channel selected" }).catch(() => undefined);
      return { sent: 0, failed: 0 };
    }
    const ctx = await sendContext();
    const results = await Promise.all(channels.map((channel) => sendAlert(channel, payload, ctx)));
    let sent = 0;
    await Promise.all(
      results.map((result, i) => {
        if (result.ok) sent += 1;
        return logAlert({ projectId, channelId: channels[i].id, event: alertLogEvent(payload), ok: result.ok, error: result.error ?? null }).catch(() => undefined);
      }),
    );
    return { sent, failed: results.length - sent };
  } catch (error) {
    console.error("[searchzen] alert delivery failed:", error);
    return { sent: 0, failed: 0 };
  }
}

/**
 * Account alerts (plan usage): sent to every active alert channel of the user and to the
 * account's email address (unless an email channel already goes there). Channel attempts are
 * logged without a project. Returns the number of successful deliveries. Never throws.
 */
export async function notifyOwner(userId: number, payload: AlertPayload): Promise<number> {
  try {
    const db = await getDb();
    const user = await db.selectFrom("users").select(["email", "status"]).where("id", "=", userId).executeTakeFirst();
    if (!user || user.status !== "active") return 0;
    const channels = (await getUserChannels(userId)).filter((c) => c.isActive);
    const ctx = await sendContext();
    const email = user.email.toLowerCase();
    const covered = channels.some((c) => c.type === "email" && (c.config as ChannelConfigByType["email"]).to.toLowerCase().split(",").some((a) => a.trim() === email));
    const jobs = channels.map(async (channel) => {
      const result = await sendAlert(channel, payload, ctx);
      await logAlert({ projectId: null, channelId: channel.id, event: alertLogEvent(payload), ok: result.ok, error: result.error ?? null }).catch(() => undefined);
      return result.ok;
    });
    if (!covered) jobs.push(withTimeout(sendEmail({ to: user.email }, payload, ctx), ctx.timeoutMs + 500).then((r) => r.ok));
    return (await Promise.all(jobs)).filter(Boolean).length;
  } catch (error) {
    console.error("[searchzen] account alert failed:", error);
    return 0;
  }
}

/** The dashboard's "Send test" button: a sample alert to one channel (logged as event "test"). */
export async function sendTestAlert(channel: ChannelRecord): Promise<SendResult> {
  const ctx = await sendContext();
  const payload = await buildAlertPayload(null, "test", `This is a test alert from ${ctx.siteName}. If you can read this, alerts to "${channel.name}" work.`, {
    example: "Real alerts tell you when keywords enter or leave the top positions, move by several places, lose their target URL, or when a site audit finishes.",
  });
  const result = await sendAlert(channel, payload, ctx);
  await logAlert({ projectId: null, channelId: channel.id, event: "test", ok: result.ok, error: result.error ?? null }).catch(() => undefined);
  return result;
}
