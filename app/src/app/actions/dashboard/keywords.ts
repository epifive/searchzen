"use server";

import { revalidatePath } from "next/cache";
import { guardDashboard } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/messages";
import { addKeywords, deleteKeywords, getProjectKeyword, setKeywordsStatus, updateKeywords } from "@/lib/keywords";
import { getOwnedProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { keywordsFromCsv } from "@/lib/rank/csv";
import { CHECK_NOW_MAX, checkKeywordsNow, takeManualChecks } from "@/lib/rank/service";
import { normalizeTags, normalizeTargetUrl, parseKeywordList, str as clean } from "@/seo/normalize";
import type { KeywordInput } from "@/seo/types";
import type { FormState } from "../types";
import { idOf, ids, str } from "./helpers";

/** Keywords per submit of the "Add keywords" form (textarea) and per CSV file. */
const MAX_TEXTAREA = 1000;
const MAX_CSV = 5000;
const MAX_CSV_BYTES = 2 * 1024 * 1024;

/**
 * Add keywords from the textarea (one per line) and / or a CSV file. Country, language,
 * device, location, tags and target URL from the form apply to every line (CSV columns win).
 */
export async function addKeywordsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  if (!rateLimit(`sz-kw-add:${guard.user.id}`, 30, 10 * 60_000)) return { error: t("rank.err.rate") };

  const defaults: Omit<KeywordInput, "phrase"> = {
    country: str(formData.get("country")) || undefined,
    language: str(formData.get("language")) || undefined,
    device: str(formData.get("device")) === "mobile" ? "mobile" : str(formData.get("device")) === "desktop" ? "desktop" : undefined,
    location: clean(formData.get("location"), "", 120) || undefined,
    tags: normalizeTags(str(formData.get("tags"))),
    targetUrl: str(formData.get("target_url")).trim() || null,
  };
  if (defaults.targetUrl && !normalizeTargetUrl(defaults.targetUrl, project.domain)) return { error: t("rank.err.targetUrl", { domain: project.domain }) };
  const inputs: KeywordInput[] = [];
  const lines = parseKeywordList(str(formData.get("keywords")), MAX_TEXTAREA + 1);
  if (lines.length > MAX_TEXTAREA) return { error: t("rank.err.tooMany", { n: MAX_TEXTAREA }) };
  for (const phrase of lines) inputs.push({ phrase, ...defaults });

  const file = formData.get("csv");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES) return { error: t("rank.err.csvSize") };
    const rows = keywordsFromCsv(await file.text(), MAX_CSV + 1);
    if (rows.length > MAX_CSV) return { error: t("rank.err.tooMany", { n: MAX_CSV }) };
    if (!rows.length) return { error: t("rank.err.csvEmpty") };
    for (const row of rows) {
      inputs.push({
        phrase: row.phrase,
        country: row.country ?? defaults.country,
        language: row.language ?? defaults.language,
        device: row.device ?? defaults.device,
        location: row.location ?? defaults.location,
        tags: row.tags?.length ? row.tags : defaults.tags,
        targetUrl: row.targetUrl ?? defaults.targetUrl,
      });
    }
  }
  if (!inputs.length) return { error: t("rank.err.noKeywords") };

  const result = await addKeywords(project, guard.entitlements, inputs);
  const parts = [plural(t, "rank.addedCount", result.added)];
  if (result.duplicates) parts.push(plural(t, "rank.duplicatesCount", result.duplicates));
  if (result.invalid) parts.push(plural(t, "rank.invalidCount", result.invalid));
  if (result.overLimit) parts.push(plural(t, "rank.overLimitCount", result.overLimit));
  revalidatePath("/dashboard", "layout");
  if (!result.added) return { error: parts.join(" ") };
  return { success: `${parts.join(" ")} ${t("rank.addedHint")}` };
}

const OPS = ["check", "pause", "resume", "delete", "tags"] as const;
type Op = (typeof OPS)[number];

/** Bulk actions on selected keywords: check now, pause, resume, delete, set tags. */
export async function bulkKeywordsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  const op = str(formData.get("op")) as Op;
  if (!OPS.includes(op)) return { error: t("rank.err.op") };
  const selected = ids(formData.getAll("ids"));
  if (!selected.length) return { error: t("rank.err.noneSelected") };

  switch (op) {
    case "check": {
      if (selected.length > CHECK_NOW_MAX) return { error: t("rank.err.checkMax", { n: CHECK_NOW_MAX }) };
      // Shared with the REST API: requests per 10 minutes and manual checks per day.
      const allowed = takeManualChecks(guard.user.id, guard.entitlements, selected.length);
      if (!allowed.ok) return { error: allowed.reason === "rate" ? t("rank.err.checkRate") : t("rank.err.checkDaily", { n: allowed.cap }) };
      const owned = (await Promise.all(selected.map((id) => getProjectKeyword(project.id, id)))).filter((k) => k !== undefined).map((k) => k.id);
      const result = await checkKeywordsNow(owned, { userId: guard.user.id });
      if (result.error === "no_provider") return { error: t("rank.err.noProvider") };
      if (result.error === "paused") return { error: t("rank.err.paused") };
      if (result.stopped) return { error: t("rank.err.providerProblem") };
      const parts = [plural(t, "rank.checkedCount", result.checked)];
      if (result.failed) parts.push(plural(t, "rank.failedCount", result.failed));
      if (result.skipped) parts.push(plural(t, "rank.skippedCount", result.skipped));
      return result.checked ? { success: parts.join(" ") } : { error: parts.join(" ") };
    }
    case "pause":
    case "resume": {
      const n = await setKeywordsStatus(project.id, selected, op === "pause" ? "paused" : "active");
      return { success: plural(t, op === "pause" ? "rank.pausedCount" : "rank.resumedCount", n) };
    }
    case "delete": {
      const n = await deleteKeywords(project.id, selected);
      revalidatePath("/dashboard", "layout");
      return { success: plural(t, "rank.deletedCount", n) };
    }
    case "tags": {
      const n = await updateKeywords(project, selected, { tags: normalizeTags(str(formData.get("tags"))) });
      return { success: plural(t, "rank.taggedCount", n) };
    }
  }
}

/** Keyword detail: change its tags and target URL. */
export async function updateKeywordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  const keyword = await getProjectKeyword(project.id, idOf(formData.get("keyword_id")));
  if (!keyword) return { error: t("rank.err.keywordNotFound") };
  const target = str(formData.get("target_url")).trim();
  if (target && !normalizeTargetUrl(target, project.domain)) return { error: t("rank.err.targetUrl", { domain: project.domain }) };
  await updateKeywords(project, [keyword.id], { tags: normalizeTags(str(formData.get("tags"))), targetUrl: target || null });
  return { success: t("rank.keywordSaved") };
}
