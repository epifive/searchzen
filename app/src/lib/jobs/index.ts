import "server-only";
import { auditsJob } from "./audits";
import { digestJob } from "./digest";
import { gscImportJob } from "./gsc-import";
import { housekeepingJob } from "./housekeeping";
import { rankChecksJob } from "./rank-checks";
import { reportsJob } from "./reports";

/**
 * Background jobs run by the scheduler (src/lib/scheduler.ts) on every tick, in order,
 * while time is left in the tick's budget. A job does a small, idempotent slice of work
 * and returns how many items it handled; anything it can't finish is picked up next tick.
 * Jobs throttle themselves (settings rows "job_next:<name>", see ./shared.ts).
 */
export interface JobContext {
  /** Epoch ms after which a job should stop starting new work. */
  deadline: number;
  /** Who started the tick. */
  source: "cron" | "worker" | "lazy" | "manual";
}

export interface Job {
  /** Short id shown in Admin → System (e.g. "rank-checks"). */
  name: string;
  run(ctx: JobContext): Promise<number>;
}

/**
 * Registered jobs, in the order they run. The SEO jobs are added here as they are built:
 * rank-checks (src/lib/serp), audits (src/lib/audit), gsc-import, reports, alerts digest.
 */
export const JOBS: Job[] = [rankChecksJob, auditsJob, gscImportJob, reportsJob, digestJob, housekeepingJob];
