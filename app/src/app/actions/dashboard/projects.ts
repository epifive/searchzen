"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveUpload } from "@/lib/admin";
import { hashPassword } from "@/lib/auth/password";
import { ownedChannelIds } from "@/lib/channels";
import { guardDashboard } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { createProject, deleteProject, getOwnedProject, setShareToken, updateProject, updateProjectSettings, type ProjectError } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { setDigestOptOut } from "@/lib/reports/digest-prefs";
import {
  ALERT_TOPS,
  CHECK_FREQUENCIES,
  AUDIT_SCHEDULES,
  USER_AGENT_MODES,
  type AlertRule,
  type ProjectSettings,
} from "@/seo/types";
import {
  httpUrl,
  int,
  MAX_ALERT_RULES,
  MAX_COMPETITORS,
  MAX_CRAWL_DELAY_MS,
  normalizeAlertRules,
  normalizeColor,
  normalizeCountry,
  normalizeDevice,
  normalizeDomain,
  normalizeLanguage,
  normalizePattern,
  normalizeProjectSettings,
  str as clean,
} from "@/seo/normalize";
import type { FormState } from "../types";
import { idOf, parseJsonField, str } from "./helpers";

const ERROR_KEYS: Record<ProjectError, MessageKey> = {
  name: "dash.projects.err.name",
  domain: "dash.projects.err.domain",
  limit: "dash.projects.err.limit",
  duplicate: "dash.projects.err.duplicate",
};

/** Create a project (name, domain, default country / language / device) and open it. */
export async function createProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!rateLimit(`sz-project-create:${guard.user.id}`, 20, 60 * 60_000)) return { error: t("dash.projects.err.rate") };
  const device = str(formData.get("device"));
  const result = await createProject(guard.user.id, guard.entitlements, {
    name: str(formData.get("name")),
    domain: str(formData.get("domain")),
    country: str(formData.get("country")),
    language: str(formData.get("language")),
    device: device === "mobile" ? "mobile" : "desktop",
  });
  if (!result.ok) return { error: t(ERROR_KEYS[result.error]) };
  // The sidebar (project switcher, usage) lives in the dashboard layout.
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/projects/${result.id}?created=1`);
}

/** Delete a project with all its keywords, rankings, audits and reports (typed confirmation). */
export async function deleteProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  if (str(formData.get("confirm")).trim().toLowerCase() !== project.domain) return { error: t("dash.projects.err.confirm", { domain: project.domain }) };
  await deleteProject(project.id);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard?deleted=1");
}

/** Lines (or commas) of a textarea. */
const lines = (v: FormDataEntryValue | null) =>
  str(v)
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const REPORT_LOGO = /^report-logo-[a-f0-9]{12}\.(png|jpg|webp|gif)$/;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Save one section of the project settings form. Every section is merged into the stored
 * settings and validated with normalizeProjectSettings(); plan limits are checked here.
 */
export async function saveProjectSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  const ent = guard.entitlements;
  const next: ProjectSettings = { ...project.settings };
  const section = str(formData.get("section"));

  switch (section) {
    case "general": {
      const status = formData.get("status") === "active" ? "active" : "paused";
      const result = await updateProject(project, { name: str(formData.get("name")), domain: str(formData.get("domain")), status });
      if (!result.ok) return { error: t(ERROR_KEYS[result.error]) };
      // A new domain changes which competitors are valid.
      const domain = normalizeDomain(str(formData.get("domain"))) || project.domain;
      await updateProjectSettings({ id: project.id, domain }, project.settings);
      revalidatePath("/dashboard", "layout");
      return { success: t("ps.saved") };
    }
    case "defaults":
      next.country = normalizeCountry(formData.get("country"), next.country);
      next.language = normalizeLanguage(formData.get("language"), next.language);
      next.device = normalizeDevice(formData.get("device"), next.device);
      next.location = clean(formData.get("location"), "", 120);
      break;
    case "competitors": {
      const raw = lines(formData.get("competitors"));
      const invalid = raw.filter((c) => !normalizeDomain(c));
      if (invalid.length) return { error: t("ps.err.competitor", { value: invalid[0] }) };
      const domains = [...new Set(raw.map(normalizeDomain))].filter((d) => d !== project.domain);
      if (domains.length > MAX_COMPETITORS) return { error: t("ps.err.competitorsMax", { n: MAX_COMPETITORS }) };
      next.competitors = domains;
      break;
    }
    case "checks": {
      const wanted = str(formData.get("checkFrequency"));
      if (!(CHECK_FREQUENCIES as readonly string[]).includes(wanted)) return { error: t("ps.err.generic") };
      if (wanted === "daily" && ent.checkFrequency !== "daily") return { error: t("ps.err.dailyPlan") };
      next.checkFrequency = wanted as ProjectSettings["checkFrequency"];
      break;
    }
    case "audit": {
      const schedule = str(formData.get("auditSchedule"));
      if (!(AUDIT_SCHEDULES as readonly string[]).includes(schedule)) return { error: t("ps.err.generic") };
      const limit = int(formData.get("auditPageLimit"), -1, -1, 10_000_000);
      if (limit < 0) return { error: t("ps.err.pageLimit") };
      if (ent.maxAuditPages > 0 && limit > ent.maxAuditPages) return { error: t("ps.err.pageLimitPlan", { n: ent.maxAuditPages }) };
      const delay = int(formData.get("crawlDelayMs"), -1, -1, 1_000_000);
      if (delay < 0 || delay > MAX_CRAWL_DELAY_MS) return { error: t("ps.err.crawlDelay", { n: MAX_CRAWL_DELAY_MS }) };
      const include = lines(formData.get("includePatterns"));
      const exclude = lines(formData.get("excludePatterns"));
      if (include.length > 20 || exclude.length > 20) return { error: t("ps.err.patterns") };
      const bad = [...include, ...exclude].find((p) => !normalizePattern(p));
      if (bad) return { error: t("ps.err.pattern", { value: bad }) };
      const ua = str(formData.get("userAgent"));
      next.auditSchedule = schedule as ProjectSettings["auditSchedule"];
      next.auditPageLimit = limit;
      next.crawlDelayMs = delay;
      next.includePatterns = include.map(normalizePattern);
      next.excludePatterns = exclude.map(normalizePattern);
      next.userAgent = (USER_AGENT_MODES as readonly string[]).includes(ua) ? (ua as ProjectSettings["userAgent"]) : "bot";
      break;
    }
    case "alerts": {
      const raw = parseJsonField(formData.get("rules"));
      const list = Array.isArray(raw) ? raw : [];
      if (list.length > MAX_ALERT_RULES) return { error: t("ps.err.rulesMax", { n: MAX_ALERT_RULES }) };
      const rules: AlertRule[] = normalizeAlertRules(list);
      if (rules.length !== list.length) {
        // Invalid entries (unknown type, top other than 3 / 10 / 100) or duplicates.
        const valid = list.filter((r) => normalizeAlertRules([r]).length === 1).length;
        if (valid !== list.length) return { error: t("ps.err.rule", { tops: ALERT_TOPS.join(", ") }) };
      }
      const wantedChannels = formData.getAll("channel").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
      next.alertRules = rules;
      next.alertChannelIds = await ownedChannelIds(wantedChannels, guard.user.id);
      next.alertOnAudit = formData.get("alertOnAudit") === "on";
      break;
    }
    case "branding": {
      if (!ent.allowWhiteLabel) return { error: t("ps.err.whiteLabel") };
      const color = str(formData.get("color")).trim();
      if (color && !normalizeColor(color)) return { error: t("ps.err.color") };
      let logo = str(formData.get("logo")).trim();
      if (logo && !httpUrl(logo) && !REPORT_LOGO.test(logo)) return { error: t("ps.err.logoUrl") };
      const file = formData.get("logo_file");
      if (file instanceof File && file.size > 0) {
        if (!LOGO_TYPES.includes(file.type)) return { error: t("ps.err.logoType") };
        if (file.size > 1024 * 1024) return { error: t("ps.err.logoSize") };
        try {
          logo = await saveUpload(file, "report-logo");
        } catch {
          return { error: t("ps.err.logoSave") };
        }
      }
      if (formData.get("logo_remove") === "on") logo = "";
      next.report = { companyName: clean(formData.get("companyName"), "", 120), color: normalizeColor(color), logo };
      break;
    }
    default:
      return { error: t("ps.err.generic") };
  }
  await updateProjectSettings(project, normalizeProjectSettings(next, project.domain));
  return { success: t("ps.saved") };
}

/** Public report link: on (new token when it was off), off, or regenerate (a new token: the old link stops working). */
export async function setShareAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  const mode = str(formData.get("mode"));
  if (mode === "off") {
    await setShareToken(project.id, false);
    return { success: t("rep.share.disabled") };
  }
  if (mode === "on" && project.shareToken) return { success: t("rep.share.enabled") };
  await setShareToken(project.id, true);
  return { success: t(mode === "regenerate" ? "rep.share.regenerated" : "rep.share.enabled") };
}

/** Set (4–100 characters) or remove the report password. */
export async function setSharePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const project = await getOwnedProject(idOf(formData.get("project_id")), guard.user.id);
  if (!project) return { error: t("dash.projects.err.notFound") };
  if (formData.get("remove") === "1") {
    await updateProjectSettings(project, { ...project.settings, sharePasswordHash: "" });
    return { success: t("rep.password.removed") };
  }
  const password = str(formData.get("password"));
  if (password.length < 4 || password.length > 100) return { error: t("rep.password.err") };
  await updateProjectSettings(project, { ...project.settings, sharePasswordHash: await hashPassword(password) });
  return { success: t("rep.password.saved") };
}

/** Weekly digest email on / off for the signed-in account. */
export async function setDigestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const on = formData.get("digest") === "on";
  await setDigestOptOut(guard.user.id, !on);
  return { success: t(on ? "digest.on" : "digest.off") };
}
