"use server";

import { createApiKey, deleteApiKey, getUserApiKeys, MAX_API_KEYS } from "@/lib/api-keys";
import { guardDashboard } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { FormState } from "../types";
import { idOf, str } from "./helpers";

export interface ApiKeyState extends FormState {
  /** The new key, shown once. */
  key?: string;
}

export async function createApiKeyAction(_prev: ApiKeyState, formData: FormData): Promise<ApiKeyState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!guard.entitlements.allowApi) return { error: t("dash.api.upgrade") };
  const name = str(formData.get("name")).trim();
  if (!name || name.length > 120) return { error: t("dash.err.keyName") };
  if ((await getUserApiKeys(guard.user.id)).length >= MAX_API_KEYS) return { error: t("dash.err.keyLimit", { n: MAX_API_KEYS }) };
  const { key } = await createApiKey(guard.user.id, name);
  return { success: t("dash.api.created"), key };
}

export async function deleteApiKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!(await deleteApiKey(guard.user.id, idOf(formData.get("key_id"))))) return { error: t("dash.err.keyNotFound") };
  return { success: t("dash.api.revoked") };
}
