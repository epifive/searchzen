import "server-only";
import { getActiveProvider, getRankPause, providerCapabilities, providerName, type ProviderProblem, type RankPause } from "@/lib/serp";
import type { RankDepth } from "@/seo/types";

export interface RankStatus {
  /** A provider is configured and checks are not paused. */
  ready: boolean;
  /** Why no provider is available (null when one is). */
  problem: ProviderProblem | null;
  pause: RankPause | null;
  providerId: string | null;
  /** Name of the active provider ("" when none). */
  providerName: string;
  simulated: boolean;
  depth: RankDepth;
  /** The active provider returns mobile results (true when there is none). */
  supportsDevice: boolean;
  /** The active provider uses city / region locations (true when there is none). */
  supportsLocation: boolean;
}

/** Whether rank checks can run, for the dashboard notices. */
export async function getRankStatus(): Promise<RankStatus> {
  const [active, pause] = await Promise.all([getActiveProvider(), getRankPause()]);
  const providerId = active.provider ? active.provider.id : null;
  return {
    ready: Boolean(active.provider) && !pause,
    problem: active.provider ? null : active.problem,
    pause,
    providerId,
    providerName: providerId ? providerName(providerId) : "",
    simulated: providerId === "simulated",
    depth: active.config.depth,
    ...(providerId ? providerCapabilities(providerId) : { supportsDevice: true, supportsLocation: true }),
  };
}
