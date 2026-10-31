import "server-only";
import { mailConfigured, sendMail } from "@/lib/mail";
import { getSettings } from "@/lib/settings";
import type { AlertPayload, ChannelConfigByType } from "@/seo/types";
import { alertPlainText, describeAlert, type SendContext, type SendResult } from "./format";

export async function sendEmail(config: ChannelConfigByType["email"], payload: AlertPayload, ctx: SendContext): Promise<SendResult> {
  if (!config.to) return { ok: false, error: "No email address configured" };
  const settings = await getSettings();
  if (!mailConfigured(settings)) return { ok: false, error: "Email is not configured on this platform (Admin → Settings → Email)" };
  const t = describeAlert(payload, ctx.siteName);
  try {
    // sendMail builds the HTML version (links, paragraphs, branding) from the plain text.
    await sendMail({ to: config.to, subject: t.subject, text: alertPlainText(payload, ctx.siteName) });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sending failed" };
  }
}
