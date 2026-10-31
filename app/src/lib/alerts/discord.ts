import "server-only";
import type { AlertPayload, ChannelConfigByType } from "@/seo/types";
import { describeAlert, type SendContext, type SendResult } from "./format";
import { deliver } from "./webhook";

/** Discord webhook: one embed with the event colour. */
export async function sendDiscord(config: ChannelConfigByType["discord"], payload: AlertPayload, ctx: SendContext): Promise<SendResult> {
  if (!config.webhookUrl) return { ok: false, error: "No Discord webhook URL configured" };
  const t = describeAlert(payload, ctx.siteName);
  const body = {
    username: ctx.siteName.replace(/discord/gi, "").trim().slice(0, 80) || "SEO alerts",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: t.title.slice(0, 256),
        url: /^https?:\/\//.test(payload.url) ? payload.url : undefined,
        description: t.summary.slice(0, 2000),
        color: Number.parseInt(t.color.slice(1), 16),
        fields: t.facts.slice(0, 10).map(([name, value]) => ({ name, value: value.slice(0, 1000) || "-", inline: true })),
        timestamp: payload.sentAt,
        footer: { text: ctx.siteName.slice(0, 200) },
      },
    ],
  };
  return deliver(config.webhookUrl, JSON.stringify(body), ctx, {}, (status) =>
    status === 401 || status === 404 ? `Discord rejected the webhook (HTTP ${status}). Check the webhook URL.` : undefined,
  );
}
