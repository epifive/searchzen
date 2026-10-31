import "server-only";
import type { AlertPayload, ChannelConfigByType } from "@/seo/types";
import { describeAlert, type SendContext, type SendResult } from "./format";
import { deliver } from "./webhook";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Slack incoming webhook: coloured attachment with Block Kit sections. */
export async function sendSlack(config: ChannelConfigByType["slack"], payload: AlertPayload, ctx: SendContext): Promise<SendResult> {
  if (!config.webhookUrl) return { ok: false, error: "No Slack webhook URL configured" };
  const t = describeAlert(payload, ctx.siteName);
  const body = {
    text: t.title,
    attachments: [
      {
        color: t.color,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*<${payload.url}|${esc(t.title)}>*\n${esc(t.summary)}` } },
          {
            type: "section",
            fields: t.facts.slice(0, 10).map(([k, v]) => ({ type: "mrkdwn", text: `*${esc(k)}*\n${esc(v).slice(0, 1900)}` })),
          },
          { type: "context", elements: [{ type: "mrkdwn", text: esc(ctx.siteName) }] },
        ],
      },
    ],
  };
  return deliver(config.webhookUrl, JSON.stringify(body), ctx, {}, (status) =>
    status === 403 || status === 404 ? `Slack rejected the webhook (HTTP ${status}). Check the webhook URL.` : undefined,
  );
}
