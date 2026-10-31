import "server-only";
import { loadDueItems, PlanGate, runChecks } from "@/lib/rank/check";
import { getActiveProvider, getRankPause } from "@/lib/serp";
import type { Job } from "./index";

/**
 * rank-checks (every tick): checks due keywords (active keyword, project and owner;
 * next_check_at reached) with the active SERP provider, in batches, with the provider's
 * concurrency, within the configured share of the tick (Admin → Settings → Rank tracking:
 * "Time per tick", "Checks per tick"). Stops for a while after configuration or quota errors.
 * Returns the number of keywords checked.
 */

/** Never start a check in the last second and a half of the budget. */
const SAFETY_MS = 1_500;

export const rankChecksJob: Job = {
  name: "rank-checks",
  async run(ctx) {
    if (await getRankPause()) return 0;
    const active = await getActiveProvider();
    if (!active.provider) return 0;
    const { provider, config } = active;
    const deadline = Math.min(ctx.deadline, Date.now() + config.budgetSeconds * 1000) - SAFETY_MS;
    const gate = new PlanGate();
    let checked = 0;
    let started = 0;
    while (Date.now() < deadline && started < config.maxPerTick) {
      const items = await loadDueItems(Math.min(config.maxPerTick - started, Math.max(4, config.concurrency * 4)));
      if (!items.length) break;
      started += items.length;
      const summary = await runChecks(items, { provider, config, deadline, gate });
      checked += summary.checked;
      if (summary.stopped || summary.checked + summary.failed + summary.skipped === 0) break;
    }
    return checked;
  },
};
