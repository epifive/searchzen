import "server-only";
import { getDb, now } from "./db";
import type { Plan } from "./db/schema";
import type { SessionUser } from "./auth/session";
import type { CheckFrequency } from "@/seo/types";

export interface Entitlements {
  plan: Plan | null;
  /** True when the user has an active paid plan. */
  isPremium: boolean;
  /** Limits; 0 means unlimited. */
  maxProjects: number;
  /** Tracked keywords across all of the user's projects. */
  maxKeywords: number;
  /** Fastest rank check schedule. */
  checkFrequency: CheckFrequency;
  /** Pages crawled per site audit. */
  maxAuditPages: number;
  /** Site audits started per calendar month (all projects). */
  maxAuditsMonthly: number;
  /** Google Search Console integration. */
  allowGsc: boolean;
  /** Custom logo, colour and company name on client reports. */
  allowWhiteLabel: boolean;
  /** REST API access (/api/v1). */
  allowApi: boolean;
  /** Hide the "Powered by" line in shared reports, badges and emails. */
  removeBranding: boolean;
  expiresAt: string | null;
}

type Limits = Omit<Entitlements, "plan" | "isPremium" | "expiresAt">;

/** Limits used if no plan is marked as the free plan (the same as the default free plan). */
const FALLBACK_FREE: Limits = {
  maxProjects: 1,
  maxKeywords: 10,
  checkFrequency: "weekly",
  maxAuditPages: 100,
  maxAuditsMonthly: 2,
  allowGsc: false,
  allowWhiteLabel: false,
  allowApi: false,
  removeBranding: false,
};

/** Administrators run the platform, so their own projects are never limited. */
const ADMIN_LIMITS: Limits = {
  maxProjects: 0,
  maxKeywords: 0,
  checkFrequency: "daily",
  maxAuditPages: 0,
  maxAuditsMonthly: 0,
  allowGsc: true,
  allowWhiteLabel: true,
  allowApi: true,
  removeBranding: true,
};

export async function getActivePlans(): Promise<Plan[]> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().where("is_active", "=", 1).orderBy("sort_order").orderBy("id").execute();
}

export async function getAllPlans(): Promise<Plan[]> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().orderBy("sort_order").orderBy("id").execute();
}

export async function getPlan(id: number): Promise<Plan | undefined> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function getFreePlan(): Promise<Plan | undefined> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().where("is_free", "=", 1).orderBy("id").executeTakeFirst();
}

export function hasActivePaidPlan(user: Pick<SessionUser, "plan_id" | "plan_expires_at"> | null): boolean {
  return Boolean(user?.plan_id && user.plan_expires_at && user.plan_expires_at > now());
}

function fromPlan(plan: Plan): Limits {
  return {
    maxProjects: plan.max_projects,
    maxKeywords: plan.max_keywords,
    checkFrequency: plan.check_frequency === "daily" ? "daily" : "weekly",
    maxAuditPages: plan.max_audit_pages,
    maxAuditsMonthly: plan.max_audits_monthly,
    allowGsc: plan.allow_gsc === 1,
    allowWhiteLabel: plan.allow_white_label === 1,
    allowApi: plan.allow_api === 1,
    removeBranding: plan.remove_branding === 1,
  };
}

export async function getEntitlements(user: Pick<SessionUser, "role" | "plan_id" | "plan_expires_at"> | null): Promise<Entitlements> {
  if (user?.role === "admin") return { plan: null, isPremium: true, ...ADMIN_LIMITS, expiresAt: null };
  if (user && hasActivePaidPlan(user)) {
    const plan = await getPlan(user.plan_id!);
    if (plan && !plan.is_free) return { plan, isPremium: true, ...fromPlan(plan), expiresAt: user.plan_expires_at };
  }
  const free = await getFreePlan();
  return {
    plan: free ?? null,
    isPremium: false,
    ...(free ? fromPlan(free) : FALLBACK_FREE),
    expiresAt: null,
  };
}

/** True when `used` has reached a limit (0 = unlimited). */
export function atLimit(used: number, limit: number): boolean {
  return limit > 0 && used >= limit;
}

/** How many more items fit under a limit (Infinity when unlimited, never negative). */
export function remaining(used: number, limit: number): number {
  return limit > 0 ? Math.max(0, limit - used) : Infinity;
}

export function planFeatures(plan: Pick<Plan, "features">): string[] {
  return (plan.features ?? "")
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

/** Entitlements of a user by id (e.g. the owner of a project in jobs and the REST API). */
export async function getEntitlementsForUserId(userId: number): Promise<Entitlements> {
  const db = await getDb();
  const user = await db.selectFrom("users").select(["role", "plan_id", "plan_expires_at"]).where("id", "=", userId).executeTakeFirst();
  return getEntitlements(user ?? null);
}
