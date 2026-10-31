import "server-only";
import { isDemoMode } from "@/lib/config";
import { getDb } from "@/lib/db";
import { DEFAULT_RANK_DEPTH, RANK_DEPTHS, type RankDepth } from "@/seo/types";
import { serpFetch, type SerpFetch } from "./http";
import type { RankProvider } from "./parse";
import { createDataForSeoProvider } from "./providers/dataforseo";
import { createSerpApiProvider } from "./providers/serpapi";
import { createSerperProvider } from "./providers/serper";
import { createSimulatedProvider } from "./providers/simulated";
import { createValueSerpProvider } from "./providers/valueserp";

export type { ProviderResult, RankProvider } from "./parse";

/**
 * SERP provider registry and the "Rank tracking" settings (Admin → Settings → Rank tracking).
 * The settings live in `settings` rows (keys serp_*), API keys may also come from the
 * environment (SERPER_API_KEY, SERPAPI_API_KEY, DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD,
 * VALUESERP_API_KEY, and SERP_PROVIDER for the active one). Keys are never sent to the browser.
 */

export const REAL_PROVIDER_IDS = ["serper", "serpapi", "dataforseo", "valueserp"] as const;
export type RealProviderId = (typeof REAL_PROVIDER_IDS)[number];
export type ProviderId = RealProviderId | "simulated";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  keyLabel: string;
  keyPlaceholder: string;
  website: string;
  /** Short pricing / behaviour note for the admin panel. */
  note: string;
  /** Mobile results are available (otherwise mobile keywords get desktop results). */
  supportsDevice: boolean;
  /** City / region locations are used (otherwise the whole country is checked). */
  supportsLocation: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "serper",
    name: "Serper.dev",
    keyLabel: "API key",
    keyPlaceholder: "Your Serper.dev API key",
    website: "https://serper.dev",
    note: "1 credit per page of 10 results. Desktop results only. 2,500 free credits to start.",
    supportsDevice: false,
    supportsLocation: true,
  },
  {
    id: "serpapi",
    name: "SerpApi",
    keyLabel: "API key",
    keyPlaceholder: "Your SerpApi private key",
    website: "https://serpapi.com",
    note: "1 search per page of 10 results. Desktop and mobile, city-level locations.",
    supportsDevice: true,
    supportsLocation: true,
  },
  {
    id: "dataforseo",
    name: "DataForSEO",
    keyLabel: "API login and password",
    keyPlaceholder: "login:password",
    website: "https://dataforseo.com",
    note: "Live mode, billed per page of 10 results crawled. Stops early once your domain is found (projects without competitors).",
    supportsDevice: true,
    supportsLocation: true,
  },
  {
    id: "valueserp",
    name: "ValueSERP",
    keyLabel: "API key",
    keyPlaceholder: "Your ValueSERP API key",
    website: "https://www.valueserp.com",
    note: "1 credit per page of 10 results. Desktop and mobile, place-name locations.",
    supportsDevice: true,
    supportsLocation: true,
  },
  {
    id: "simulated",
    name: "Simulated (testing only)",
    keyLabel: "",
    keyPlaceholder: "",
    website: "",
    note: "Generates realistic but fake positions without any API. For demos and testing only, never for real clients.",
    supportsDevice: true,
    supportsLocation: true,
  },
];

export function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

/** What a provider can do (unknown ids: everything). */
export function providerCapabilities(id: string): Pick<ProviderInfo, "supportsDevice" | "supportsLocation"> {
  const p = PROVIDERS.find((x) => x.id === id);
  return { supportsDevice: p?.supportsDevice ?? true, supportsLocation: p?.supportsLocation ?? true };
}

export interface RankConfig {
  /** Chosen provider ("" = none). */
  provider: ProviderId | "";
  /** API keys by provider ("" = not set). */
  keys: Record<RealProviderId, string>;
  /** Which keys come from the environment (can't be changed in the admin panel). */
  envKeys: Record<RealProviderId, boolean>;
  depth: RankDepth;
  /** Keyword checks per scheduler tick at most. */
  maxPerTick: number;
  /** Provider requests running at the same time. */
  concurrency: number;
  /** Seconds of each tick the rank job may use. */
  budgetSeconds: number;
  /** The administrator allowed the Simulated provider outside demo mode. */
  allowSimulated: boolean;
}

export const RANK_KEYS = {
  provider: "serp_provider",
  depth: "serp_depth",
  maxPerTick: "serp_max_per_tick",
  concurrency: "serp_concurrency",
  budget: "serp_tick_budget",
  allowSimulated: "serp_allow_simulated",
  pauseUntil: "serp_pause_until",
  pauseReason: "serp_pause_reason",
  key: (id: RealProviderId) => `serp_key_${id}`,
} as const;

export const RANK_DEFAULTS = { depth: DEFAULT_RANK_DEPTH, maxPerTick: 40, concurrency: 3, budgetSeconds: 20 };
export const RANK_LIMITS = { maxPerTick: [1, 500], concurrency: [1, 10], budgetSeconds: [5, 50] } as const;

async function readRows(keys: string[]): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.selectFrom("settings").select(["key", "value"]).where("key", "in", keys).execute();
  return new Map(rows.map((r) => [r.key, r.value ?? ""]));
}

export async function writeRankSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  const updated = await db.updateTable("settings").set({ value }).where("key", "=", key).executeTakeFirst();
  if (Number(updated.numUpdatedRows) > 0) return;
  const exists = await db.selectFrom("settings").select("key").where("key", "=", key).executeTakeFirst();
  if (exists) return;
  try {
    await db.insertInto("settings").values({ key, value }).execute();
  } catch {
    await db.updateTable("settings").set({ value }).where("key", "=", key).execute();
  }
}

const clampInt = (raw: string | undefined, fallback: number, [min, max]: readonly [number, number]) => {
  const n = Number(raw);
  return Number.isFinite(n) && raw !== "" && raw !== undefined ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

function envKey(id: RealProviderId): string {
  const e = process.env;
  switch (id) {
    case "serper":
      return e.SERPER_API_KEY?.trim() ?? "";
    case "serpapi":
      return e.SERPAPI_API_KEY?.trim() ?? "";
    case "dataforseo":
      return e.DATAFORSEO_LOGIN?.trim() && e.DATAFORSEO_PASSWORD?.trim() ? `${e.DATAFORSEO_LOGIN.trim()}:${e.DATAFORSEO_PASSWORD.trim()}` : "";
    case "valueserp":
      return e.VALUESERP_API_KEY?.trim() ?? "";
  }
}

const isProviderId = (v: string): v is ProviderId => PROVIDERS.some((p) => p.id === v);

export async function getRankConfig(): Promise<RankConfig> {
  const rows = await readRows([
    RANK_KEYS.provider,
    RANK_KEYS.depth,
    RANK_KEYS.maxPerTick,
    RANK_KEYS.concurrency,
    RANK_KEYS.budget,
    RANK_KEYS.allowSimulated,
    ...REAL_PROVIDER_IDS.map(RANK_KEYS.key),
  ]);
  const keys = {} as Record<RealProviderId, string>;
  const envKeys = {} as Record<RealProviderId, boolean>;
  for (const id of REAL_PROVIDER_IDS) {
    const fromEnv = envKey(id);
    envKeys[id] = Boolean(fromEnv);
    keys[id] = fromEnv || (rows.get(RANK_KEYS.key(id)) ?? "").trim();
  }
  const envProvider = process.env.SERP_PROVIDER?.trim().toLowerCase() ?? "";
  const stored = rows.get(RANK_KEYS.provider) ?? "";
  const provider = isProviderId(stored) ? stored : isProviderId(envProvider) ? envProvider : "";
  const depthRaw = Number(rows.get(RANK_KEYS.depth));
  return {
    provider,
    keys,
    envKeys,
    depth: (RANK_DEPTHS as readonly number[]).includes(depthRaw) ? (depthRaw as RankDepth) : RANK_DEFAULTS.depth,
    maxPerTick: clampInt(rows.get(RANK_KEYS.maxPerTick), RANK_DEFAULTS.maxPerTick, RANK_LIMITS.maxPerTick),
    concurrency: clampInt(rows.get(RANK_KEYS.concurrency), RANK_DEFAULTS.concurrency, RANK_LIMITS.concurrency),
    budgetSeconds: clampInt(rows.get(RANK_KEYS.budget), RANK_DEFAULTS.budgetSeconds, RANK_LIMITS.budgetSeconds),
    allowSimulated: rows.get(RANK_KEYS.allowSimulated) === "1",
  };
}

/** The Simulated provider may run: demo mode, or the administrator enabled it explicitly. */
export function simulatedAvailable(config: Pick<RankConfig, "allowSimulated">): boolean {
  return isDemoMode() || config.allowSimulated;
}

/** A provider instance for an id and key (also used by "Test connection" with an unsaved key). */
export function createProvider(id: ProviderId, apiKey: string, fetcher: SerpFetch = serpFetch): RankProvider {
  const options = { apiKey, fetch: fetcher, timeoutMs: 20_000 };
  switch (id) {
    case "serper":
      return createSerperProvider(options);
    case "serpapi":
      return createSerpApiProvider(options);
    case "dataforseo":
      return createDataForSeoProvider(options);
    case "valueserp":
      return createValueSerpProvider(options);
    case "simulated":
      return createSimulatedProvider();
  }
}

export type ProviderProblem = "none" | "no_key" | "simulated_off";

/**
 * The provider rank checks use now, or why there is none. With no provider chosen, demo mode
 * uses the Simulated provider.
 */
export async function getActiveProvider(config?: RankConfig): Promise<{ provider: RankProvider; config: RankConfig } | { provider: null; config: RankConfig; problem: ProviderProblem }> {
  const cfg = config ?? (await getRankConfig());
  const id = cfg.provider || (isDemoMode() ? "simulated" : "");
  if (!id) return { provider: null, config: cfg, problem: "none" };
  if (id === "simulated") {
    if (!simulatedAvailable(cfg)) return { provider: null, config: cfg, problem: "simulated_off" };
    return { provider: createProvider("simulated", ""), config: cfg };
  }
  const key = cfg.keys[id];
  if (!key) return { provider: null, config: cfg, problem: "no_key" };
  return { provider: createProvider(id, key), config: cfg };
}

// ── Global pause after configuration / quota errors ──

export interface RankPause {
  until: string;
  reason: string;
}

/** Rank checks are paused (wrong key, credits exhausted…) until this time, or null. */
export async function getRankPause(): Promise<RankPause | null> {
  const rows = await readRows([RANK_KEYS.pauseUntil, RANK_KEYS.pauseReason]);
  const until = rows.get(RANK_KEYS.pauseUntil) ?? "";
  if (!until || until <= new Date().toISOString()) return null;
  return { until, reason: rows.get(RANK_KEYS.pauseReason) ?? "" };
}

export async function setRankPause(ms: number, reason: string): Promise<void> {
  await writeRankSetting(RANK_KEYS.pauseUntil, new Date(Date.now() + ms).toISOString());
  await writeRankSetting(RANK_KEYS.pauseReason, reason.slice(0, 300));
}

export async function clearRankPause(): Promise<void> {
  await writeRankSetting(RANK_KEYS.pauseUntil, "");
  await writeRankSetting(RANK_KEYS.pauseReason, "");
}

// ── Provider usage (Admin → Rank tracking) ──

/** Add to today's provider_usage row (requests, errors, credits). */
export async function recordProviderUsage(provider: string, delta: { requests?: number; errors?: number; credits?: number }, day = new Date().toISOString().slice(0, 10)): Promise<void> {
  const requests = Math.max(0, Math.trunc(delta.requests ?? 0));
  const errors = Math.max(0, Math.trunc(delta.errors ?? 0));
  const credits = Math.max(0, Math.trunc(delta.credits ?? 0));
  if (!requests && !errors && !credits) return;
  const db = await getDb();
  const update = () =>
    db
      .updateTable("provider_usage")
      .set((eb) => ({ requests: eb("requests", "+", requests), errors: eb("errors", "+", errors), credits: eb("credits", "+", credits) }))
      .where("provider", "=", provider)
      .where("day", "=", day)
      .executeTakeFirst();
  const updated = await update();
  if (Number(updated.numUpdatedRows) > 0) return;
  try {
    await db.insertInto("provider_usage").values({ provider, day, requests, errors, credits }).execute();
  } catch {
    await update();
  }
}

export interface ProviderUsageRow {
  provider: string;
  day: string;
  requests: number;
  errors: number;
  credits: number;
}

/** provider_usage rows of the last `days` days, newest first. */
export async function getProviderUsage(days = 30): Promise<ProviderUsageRow[]> {
  const db = await getDb();
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.selectFrom("provider_usage").selectAll().where("day", ">=", from).orderBy("day", "desc").orderBy("provider").execute();
  return rows.map((r) => ({ provider: r.provider, day: r.day, requests: Number(r.requests), errors: Number(r.errors), credits: Number(r.credits) }));
}
