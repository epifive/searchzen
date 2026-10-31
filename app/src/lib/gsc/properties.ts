import "server-only";
import { getDb, now } from "@/lib/db";
import type { ProjectRecord } from "@/lib/projects";
import { hostMatches } from "@/seo/normalize";
import { newImportState, readImportState, runImportStep, writeImportState, type GscImportState } from "./import";

/**
 * Search Console property of a project: "sc-domain:example.com" (domain property, every
 * protocol and subdomain) or a URL-prefix property ("https://www.example.com/").
 */

/** "sc-domain:example.com" / "https://www.example.com/" → its host ("example.com", "www.example.com"). */
export function propertyHost(property: string): string {
  if (property.startsWith("sc-domain:")) return property.slice(10).toLowerCase();
  try {
    return new URL(property).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Human label: "example.com (domain)" style parts. */
export function propertyKind(property: string): "domain" | "prefix" {
  return property.startsWith("sc-domain:") ? "domain" : "prefix";
}

/** True when the property covers the project's domain (used to sort the picker). */
export function propertyMatchesDomain(property: string, domain: string): boolean {
  const host = propertyHost(property);
  return Boolean(host) && (hostMatches(host, domain) || hostMatches(domain, host.replace(/^www\./, "")));
}

/**
 * Assign a property to a project (the caller checked the connection can read it). A different
 * property clears the project's imported rows and starts a new 90-day backfill.
 */
export async function assignProperty(project: Pick<ProjectRecord, "id" | "gscProperty">, connectionId: number, property: string): Promise<void> {
  const db = await getDb();
  const changed = project.gscProperty !== property;
  await db.updateTable("projects").set({ gsc_property: property, gsc_connection_id: connectionId, updated_at: now() }).where("id", "=", project.id).execute();
  if (changed) {
    await db.deleteFrom("gsc_daily").where("project_id", "=", project.id).execute();
    await writeImportState(project.id, newImportState(property));
  } else {
    // Same property (e.g. after reconnecting): retry right away.
    const state = await readImportState(project.id);
    if (state) await writeImportState(project.id, { ...state, retryAt: null });
  }
}

/** Remove the property from a project (imported rows are deleted with it). */
export async function unassignProperty(projectId: number): Promise<void> {
  const db = await getDb();
  await db.updateTable("projects").set({ gsc_property: null, gsc_connection_id: null, updated_at: now() }).where("id", "=", projectId).execute();
  await db.deleteFrom("gsc_daily").where("project_id", "=", projectId).execute();
  await writeImportState(projectId, null);
}

/** Import the newest window right away (after assigning), within a small time budget. Never throws. */
export async function importFirstWindow(project: { id: number; property: string; connectionId: number }): Promise<void> {
  try {
    await Promise.race([runImportStep(project), new Promise((resolve) => setTimeout(resolve, 15_000))]);
  } catch {
    // The job retries.
  }
}

export type { GscImportState };
