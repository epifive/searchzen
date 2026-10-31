"use server";

import { cookies, headers } from "next/headers";
import type { FormState } from "@/app/actions/types";
import { verifyPassword } from "@/lib/auth/password";
import { getT } from "@/lib/i18n/server";
import { getProjectByShareToken } from "@/lib/projects";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { unlockCookieName, unlockCookieValue, UNLOCK_DAYS } from "@/lib/reports/share";

/** Check the password of a shared report and remember the visitor for 30 days. */
export async function unlockReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const token = String(formData.get("token") ?? "");
  const project = await getProjectByShareToken(token);
  if (!project) return { error: t("rep.gate.gone") };
  const ip = await clientIp();
  if (!rateLimit(`report-unlock:${token}:${ip}`, 10, 10 * 60_000)) return { error: t("rep.gate.rate") };
  const hash = project.settings.sharePasswordHash;
  if (!hash) return { success: "ok" };
  if (!(await verifyPassword(String(formData.get("password") ?? ""), hash))) return { error: t("rep.gate.wrong") };
  const h = await headers();
  const https = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https" || (h.get("origin") ?? "").startsWith("https://");
  (await cookies()).set(unlockCookieName(token), await unlockCookieValue(token, hash), {
    httpOnly: true,
    sameSite: "lax",
    secure: https,
    path: `/r/${token}`,
    maxAge: UNLOCK_DAYS * 86_400,
  });
  return { success: "ok" };
}
