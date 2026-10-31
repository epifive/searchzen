import "server-only";
import { getDb } from "@/lib/db";
import { REVOKED } from "@/lib/gsc/connections";
import { pruneOldRows, runImportStep } from "@/lib/gsc/import";
import { getEntitlementsForUserId } from "@/lib/plans";
import type { Job } from "./index";
import { isDue, scheduleNext, writeKey } from "./shared";

/**
 * gsc-import: Search Console data of every project with a property (see src/lib/gsc/import.ts).
 * Each step imports one window (a backfill window or the daily refresh) for one project; steps
 * run until the tick's budget is nearly used. While backfills are pending the job runs on every
 * tick, otherwise every 10 minutes. Projects whose owner's plan lost Search Console, whose
 * connection is broken, that are paused or whose owner is banned are skipped.
 */

const IDLE_MS = 10 * 60_000;
/** Leave this much of the tick for the jobs after this one. */
const RESERVE_MS = 4_000;

export const gscImportJob: Job = {
  name: "gsc-import",
  async run(ctx) {
    if (!(await isDue("gsc-import", ctx))) return 0;
    const db = await getDb();
    const projects = await db
      .selectFrom("projects")
      .innerJoin("gsc_connections", "gsc_connections.id", "projects.gsc_connection_id")
      .innerJoin("users", "users.id", "projects.user_id")
      .select(["projects.id", "projects.user_id", "projects.gsc_property", "projects.gsc_connection_id", "gsc_connections.last_error"])
      .where("projects.status", "=", "active")
      .where("users.status", "=", "active")
      .where("projects.gsc_property", "is not", null)
      .orderBy("projects.id")
      .execute();
    let steps = 0;
    let pending = false;
    const allowed = new Map<number, boolean>();
    for (const p of projects) {
      if (Date.now() > ctx.deadline - RESERVE_MS) {
        pending = true;
        break;
      }
      if (p.last_error === REVOKED || !p.gsc_property || !p.gsc_connection_id) continue;
      if (!allowed.has(p.user_id)) allowed.set(p.user_id, (await getEntitlementsForUserId(p.user_id)).allowGsc);
      if (!allowed.get(p.user_id)) continue;
      const project = { id: p.id, property: p.gsc_property, connectionId: p.gsc_connection_id };
      // Several steps per project while its backfill runs and time is left.
      for (let i = 0; i < 20 && Date.now() < ctx.deadline - RESERVE_MS; i++) {
        const result = await runImportStep(project);
        if (!result) break;
        steps += 1;
        if (!result.ok) break;
        if (result.done) break;
        pending = true;
      }
    }
    // Once a day: drop rows older than Search Console keeps.
    const pruneKey = "gsc_pruned_on";
    const day = new Date().toISOString().slice(0, 10);
    const pruned = await db.selectFrom("settings").select("value").where("key", "=", pruneKey).executeTakeFirst();
    if (pruned?.value !== day) {
      await pruneOldRows();
      await writeKey(pruneKey, day);
    }
    await scheduleNext("gsc-import", pending ? 0 : IDLE_MS);
    return steps;
  },
};
