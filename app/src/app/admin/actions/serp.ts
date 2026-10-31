"use server";

import { revalidatePath } from "next/cache";
import { guardAdmin } from "@/lib/admin";
import { isDemoMode } from "@/lib/config";
import { rateLimit } from "@/lib/rate-limit";
import {
  clearRankPause,
  createProvider,
  getRankConfig,
  PROVIDERS,
  RANK_KEYS,
  RANK_LIMITS,
  REAL_PROVIDER_IDS,
  recordProviderUsage,
  simulatedAvailable,
  writeRankSetting,
  type ProviderId,
} from "@/lib/serp";
import { normalizeCountry, normalizeDomain, normalizeKeyword } from "@/seo/normalize";
import { RANK_DEPTHS, SerpProviderError } from "@/seo/types";
import type { FormState } from "@/app/actions/types";

const PATH = "/admin/settings/rank-tracking";

function intIn(v: FormDataEntryValue | null, [min, max]: readonly [number, number]): number | null {
  const n = Number(typeof v === "string" ? v.trim() : NaN);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Save the rank tracking settings: provider, API keys (empty = keep), depth, per-tick limits. */
export async function saveRankSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const provider = String(formData.get("provider") ?? "");
  if (provider && !PROVIDERS.some((p) => p.id === provider)) return { error: "Choose a valid provider." };
  const allowSimulated = formData.get("allow_simulated") === "on";
  if (provider === "simulated" && !allowSimulated && !isDemoMode()) {
    return { error: "Turn on \"Allow the Simulated provider\" to use it. It produces fake positions and is meant for testing only." };
  }
  const depth = Number(formData.get("depth"));
  if (!(RANK_DEPTHS as readonly number[]).includes(depth)) return { error: "Choose a depth of 10, 20, 50 or 100 results." };
  const maxPerTick = intIn(formData.get("max_per_tick"), RANK_LIMITS.maxPerTick);
  if (maxPerTick === null) return { error: `Checks per run must be a whole number from ${RANK_LIMITS.maxPerTick[0]} to ${RANK_LIMITS.maxPerTick[1]}.` };
  const concurrency = intIn(formData.get("concurrency"), RANK_LIMITS.concurrency);
  if (concurrency === null) return { error: `Parallel requests must be a whole number from ${RANK_LIMITS.concurrency[0]} to ${RANK_LIMITS.concurrency[1]}.` };
  const budget = intIn(formData.get("budget"), RANK_LIMITS.budgetSeconds);
  if (budget === null) return { error: `Time per run must be from ${RANK_LIMITS.budgetSeconds[0]} to ${RANK_LIMITS.budgetSeconds[1]} seconds.` };

  const config = await getRankConfig();
  for (const id of REAL_PROVIDER_IDS) {
    if (formData.get(`clear_${id}`) === "on") {
      await writeRankSetting(RANK_KEYS.key(id), "");
      continue;
    }
    const key = String(formData.get(`key_${id}`) ?? "").trim();
    if (!key) continue;
    if (key.length > 300 || /\s/.test(key)) return { error: `The ${PROVIDERS.find((p) => p.id === id)?.name} key doesn't look right.` };
    if (id === "dataforseo" && !/^[^:]+:.+$/.test(key)) return { error: "Enter the DataForSEO API login and password as login:password." };
    await writeRankSetting(RANK_KEYS.key(id), key);
  }
  const fresh = await getRankConfig();
  if (provider && provider !== "simulated" && !fresh.keys[provider as Exclude<ProviderId, "simulated">]) {
    return { error: `Enter the ${PROVIDERS.find((p) => p.id === provider)?.name} API key to use it.` };
  }
  await writeRankSetting(RANK_KEYS.provider, provider);
  await writeRankSetting(RANK_KEYS.depth, String(depth));
  await writeRankSetting(RANK_KEYS.maxPerTick, String(maxPerTick));
  await writeRankSetting(RANK_KEYS.concurrency, String(concurrency));
  await writeRankSetting(RANK_KEYS.budget, String(budget));
  await writeRankSetting(RANK_KEYS.allowSimulated, allowSimulated ? "1" : "0");
  // A new provider or key gets a fresh start.
  if (provider !== config.provider || REAL_PROVIDER_IDS.some((id) => fresh.keys[id] !== config.keys[id])) await clearRankPause();
  revalidatePath(PATH);
  return { success: "Rank tracking settings saved." };
}

export interface TestState extends FormState {
  result?: {
    provider: string;
    position: number | null;
    url: string | null;
    features: string[];
    results: Array<{ position: number; domain: string; url: string }>;
    requests: number;
    credits: number | null;
    ms: number;
  };
}

/** "Test connection": one real check of a sample keyword with the chosen provider (counted in the usage). */
export async function testRankProvider(_prev: TestState, formData: FormData): Promise<TestState> {
  // Allowed in the demo, but only with the Simulated provider there.
  const guard = await guardAdmin({ allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  if (!rateLimit(`sz-serp-test:${guard.user.id}`, 10, 10 * 60_000)) return { error: "Too many tests. Wait a few minutes." };
  const id = String(formData.get("provider") ?? "") as ProviderId;
  const info = PROVIDERS.find((p) => p.id === id);
  if (!info) return { error: "Choose a provider to test." };
  const config = await getRankConfig();
  if (isDemoMode() && id !== "simulated") return { error: "In the demo only the Simulated provider can be tested." };
  if (id === "simulated" && !simulatedAvailable(config)) return { error: "The Simulated provider is turned off." };
  const typedKey = String(formData.get("key") ?? "").trim();
  const key = id === "simulated" ? "" : typedKey || config.keys[id];
  if (id !== "simulated" && !key) return { error: `No ${info.name} API key is saved. Enter one above or in the test form.` };
  const phrase = normalizeKeyword(String(formData.get("keyword") ?? "")) || "coffee";
  const domain = normalizeDomain(String(formData.get("domain") ?? "")) || "wikipedia.org";
  const country = normalizeCountry(String(formData.get("country") ?? ""), "US");
  const started = Date.now();
  try {
    const result = await createProvider(id, key).check({ phrase, country, language: "en", device: "desktop", location: "", depth: config.depth, domain, competitors: [] });
    await recordProviderUsage(id, { requests: result.requests, credits: result.credits ?? 0 }).catch(() => undefined);
    return {
      success: `${info.name} answered in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
      result: {
        provider: info.name,
        position: result.position,
        url: result.url,
        features: result.features,
        results: result.results.slice(0, 10).map((r) => ({ position: r.position, domain: r.domain, url: r.url })),
        requests: result.requests,
        credits: result.credits ?? null,
        ms: Date.now() - started,
      },
    };
  } catch (error) {
    await recordProviderUsage(id, { errors: 1 }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "The test failed.";
    const hint = error instanceof SerpProviderError && error.kind === "config" ? " Check the API key." : error instanceof SerpProviderError && error.kind === "quota" ? " Check the credits of your plan." : "";
    return { error: `${message}${hint}` };
  }
}

/** Resume rank checks paused after a provider error. */
export async function resumeRankChecks(): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  await clearRankPause();
  revalidatePath(PATH);
  return { success: "Rank checks resumed." };
}
