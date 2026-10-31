"use server";

import { guardDashboard } from "@/lib/dashboard";
import { deleteConnection, getOwnedConnection, listConnectionSites } from "@/lib/gsc/connections";
import { GoogleApiError } from "@/lib/gsc/google";
import { readImportState, runImportStep, writeImportState } from "@/lib/gsc/import";
import { assignProperty, importFirstWindow, unassignProperty } from "@/lib/gsc/properties";
import { getT } from "@/lib/i18n/server";
import { addKeywords } from "@/lib/keywords";
import { getOwnedProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeKeyword } from "@/seo/normalize";
import type { FormState } from "../types";
import { idOf, str } from "./helpers";

/** Use a Search Console property of one of the user's connections for a project. */
export async function assignPropertyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!guard.entitlements.allowGsc) return { error: t("gsc.err.plan") };
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  // "<connection id>|<property>" from the picker.
  const [connText, ...rest] = str(formData.get("property")).split("|");
  const property = rest.join("|");
  const conn = await getOwnedConnection(Number(connText), guard.user.id);
  if (!conn || !property) return { error: t("gsc.err.pick") };
  if (conn.broken) return { error: t("gsc.err.broken") };
  try {
    const sites = await listConnectionSites(conn.id);
    if (!sites.some((s) => s.siteUrl === property)) return { error: t("gsc.err.noAccess") };
  } catch (error) {
    return { error: error instanceof GoogleApiError && error.kind === "revoked" ? t("gsc.err.broken") : t("gsc.err.google") };
  }
  await assignProperty(project, conn.id, property);
  await importFirstWindow({ id: project.id, property, connectionId: conn.id });
  return { success: t("gsc.assigned") };
}

/** Stop using Search Console for a project (its imported rows are deleted). */
export async function unassignPropertyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  await unassignProperty(project.id);
  return { success: t("gsc.unassigned") };
}

/** Disconnect a Google account (revoked at Google; projects using it lose their property). */
export async function disconnectGscAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const conn = await getOwnedConnection(idOf(formData.get("connection_id")), guard.user.id);
  if (!conn) return { error: t("gsc.err.connection") };
  await deleteConnection(conn);
  return { success: t("gsc.disconnected") };
}

/** Import the next due window now (also retries after an error). */
export async function importNowAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project?.gscProperty || !project.gscConnectionId) return { error: t("dash.projects.err.notFound") };
  if (!guard.entitlements.allowGsc) return { error: t("gsc.err.plan") };
  if (!rateLimit(`gsc-import-now:${project.id}`, 6, 10 * 60_000)) return { error: t("gsc.err.rate") };
  const state = await readImportState(project.id);
  // Force the daily refresh even if it ran recently.
  if (state) await writeImportState(project.id, { ...state, retryAt: null, lastDailyAt: state.backfillCursor ? state.lastDailyAt : null });
  const result = await runImportStep({ id: project.id, property: project.gscProperty, connectionId: project.gscConnectionId });
  if (result && !result.ok) return { error: result.error instanceof GoogleApiError && result.error.kind === "revoked" ? t("gsc.err.broken") : t("gsc.err.importFailed", { error: result.error.message }) };
  return { success: t("gsc.imported") };
}

/** Track a Search Console query as a keyword (project defaults, plan limit). */
export async function trackQueryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  const phrase = normalizeKeyword(str(formData.get("query")));
  if (!phrase) return { error: t("gsc.err.query") };
  const result = await addKeywords(project, guard.entitlements, [{ phrase }]);
  if (result.added) return { success: t("gsc.tracked", { phrase }) };
  if (result.overLimit) return { error: t("gsc.err.keywordLimit") };
  return { success: t("gsc.alreadyTracked") };
}
