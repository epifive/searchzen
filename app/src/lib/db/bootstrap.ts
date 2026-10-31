import "server-only";
import type { Kysely } from "kysely";
import { hashPassword, verifyPassword } from "../auth/password";
import { isDemoMode } from "../config";
import { seedDemoLanguages } from "./demo-languages";
import { seedDemoData } from "./demo-seed";
import type { Database } from "./schema";

/**
 * Headless setup for platforms where the web installer can't run (Vercel,
 * Docker, CI). Runs once per server instance, right after migrations.
 *
 *   ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME  create (or promote) an administrator
 *   DEMO_SEED=true                             fill an empty database with sample data and
 *                                              install the bundled language packs, if present
 */
export async function bootstrapFromEnv(db: Kysely<Database>): Promise<void> {
  await ensureAdminFromEnv(db);
  if (process.env.DEMO_SEED === "true") {
    await seedDemoData(db);
    await seedDemoLanguages(db);
    await upgradeDemoAlertLog(db);
  }
}

/**
 * Demo databases seeded before alert_log stored the rank threshold ("rank_entered_top:3"):
 * the demo project's only top-N rule is "enters the top 3", so its bare rows get that number.
 */
async function upgradeDemoAlertLog(db: Kysely<Database>): Promise<void> {
  try {
    const demo = await db.selectFrom("projects").select("id").where("domain", "=", "northwindoutdoor.example").execute();
    if (!demo.length) return;
    await db
      .updateTable("alert_log")
      .set({ event: "rank_entered_top:3" })
      .where("event", "=", "rank_entered_top")
      .where("project_id", "in", demo.map((p) => p.id))
      .execute();
  } catch {
    // Cosmetic only.
  }
}

async function ensureAdminFromEnv(db: Kysely<Database>): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 8) return;

  const ts = new Date().toISOString();
  const existing = await db.selectFrom("users").select(["id", "role", "status", "password_hash"]).where("email", "=", email).executeTakeFirst();
  if (!existing) {
    try {
      await db
        .insertInto("users")
        .values({
          name: process.env.ADMIN_NAME?.trim() || "Administrator",
          email,
          password_hash: await hashPassword(password),
          role: "admin",
          status: "active",
          plan_id: null,
          plan_expires_at: null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          created_at: ts,
          updated_at: ts,
        })
        .execute();
    } catch {
      // Another instance created the account at the same moment.
    }
    return;
  }

  const updates: { role?: "admin"; status?: "active"; password_hash?: string; updated_at?: string } = {};
  if (existing.role !== "admin") updates.role = "admin";
  if (existing.status !== "active") updates.status = "active";
  // On a public demo the advertised password must always work.
  if (isDemoMode() && !(await verifyPassword(password, existing.password_hash))) {
    updates.password_hash = await hashPassword(password);
  }
  if (Object.keys(updates).length) {
    await db.updateTable("users").set({ ...updates, updated_at: ts }).where("id", "=", existing.id).execute();
  }
}
