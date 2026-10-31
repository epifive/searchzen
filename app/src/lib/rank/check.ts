import "server-only";
import { buildAlertPayload, notifyChannels } from "@/lib/alerts";
import { getDb, now as nowIso } from "@/lib/db";
import type { Keyword } from "@/lib/db/schema";
import { getEntitlementsForUserId, type Entitlements } from "@/lib/plans";
import { getActiveProvider, getRankPause, recordProviderUsage, setRankPause, type RankConfig, type RankProvider } from "@/lib/serp";
import { incrementUsage } from "@/lib/usage";
import { countryName, effectiveFrequency, checkIntervalMs, nextCheckAt, normalizeProjectSettings, parseJson, parseJsonList, retryDelayMs } from "@/seo/normalize";
import { SerpProviderError, type AlertEvent, type Device, type ProjectSettings, type RankResult } from "@/seo/types";
import { describeHit, evaluateRules, type RuleHit, type Transition } from "./transitions";

/**
 * The rank check engine shared by the scheduled job (src/lib/jobs/rank-checks.ts), the
 * dashboard's "Check now" and the REST API: check keywords with the active SERP provider,
 * store the day's ranking idempotently (one rankings row per keyword and UTC day, the last check
 * of the day wins), keep the keyword's latest / best / start positions, store a SERP snapshot,
 * count usage, evaluate alert rules and send the alerts.
 */

/** A keyword with what a check needs from its project. */
export interface CheckItem {
  keyword: Keyword;
  project: { id: number; userId: number; name: string; domain: string; settings: ProjectSettings };
}

export interface RunSummary {
  checked: number;
  failed: number;
  /** Not started (time budget, plan limits, provider paused). */
  skipped: number;
  alerts: number;
  /** Set when checks stopped because of a configuration or quota problem. */
  stopped: string | null;
}

const CLAIM_MS = 15 * 60_000;
const SNAPSHOT_SIZE = 20;
/** Alerts sent one by one per project and run; beyond this they are summarised in one message. */
const MAX_ALERTS_PER_PROJECT = 20;
const CONFIG_PAUSE_MS = 30 * 60_000;
const QUOTA_PAUSE_MS = 60 * 60_000;
/**
 * A keyword whose checks failed this many times in a row with an unexpected provider answer
 * ("response" errors, e.g. a location the provider doesn't know) is paused instead of being
 * retried forever; the rankings table shows why. Resuming it resets the count.
 */
export const PAUSE_AFTER_FAILURES = 3;

/** Keywords (with projects) by id; banned owners and paused projects are left out. */
export async function loadCheckItems(keywordIds: number[]): Promise<CheckItem[]> {
  if (!keywordIds.length) return [];
  const db = await getDb();
  const out: CheckItem[] = [];
  for (let i = 0; i < keywordIds.length; i += 500) {
    const rows = await db
      .selectFrom("keywords")
      .innerJoin("projects", "projects.id", "keywords.project_id")
      .innerJoin("users", "users.id", "projects.user_id")
      .selectAll("keywords")
      .select(["projects.user_id as p_user_id", "projects.name as p_name", "projects.domain as p_domain", "projects.settings as p_settings"])
      .where("keywords.id", "in", keywordIds.slice(i, i + 500))
      .where("projects.status", "=", "active")
      .where("users.status", "=", "active")
      .execute();
    for (const r of rows) out.push(toItem(r));
  }
  return out;
}

type JoinedRow = Keyword & { p_user_id: number; p_name: string; p_domain: string; p_settings: string };

function toItem(r: JoinedRow): CheckItem {
  const { p_user_id, p_name, p_domain, p_settings, ...keyword } = r;
  return { keyword, project: { id: keyword.project_id, userId: p_user_id, name: p_name, domain: p_domain, settings: normalizeProjectSettings(parseJson(p_settings), p_domain) } };
}

/** Due keywords (active keyword, active project, active owner), oldest due first. */
export async function loadDueItems(limit: number): Promise<CheckItem[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("keywords")
    .innerJoin("projects", "projects.id", "keywords.project_id")
    .innerJoin("users", "users.id", "projects.user_id")
    .selectAll("keywords")
    .select(["projects.user_id as p_user_id", "projects.name as p_name", "projects.domain as p_domain", "projects.settings as p_settings"])
    .where("keywords.status", "=", "active")
    .where("keywords.next_check_at", "<=", nowIso())
    .where("projects.status", "=", "active")
    .where("users.status", "=", "active")
    .orderBy("keywords.next_check_at")
    .orderBy("keywords.id")
    .limit(limit)
    .execute();
  return rows.map(toItem);
}

async function setNextCheck(ids: number[], at: string): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.updateTable("keywords").set({ next_check_at: at }).where("id", "in", ids).execute();
}

/** Mark keywords as being checked, so an overlapping run doesn't pick them too. */
async function claim(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  const ts = nowIso();
  await db.updateTable("keywords").set({ next_check_at: new Date(Date.now() + CLAIM_MS).toISOString() }).where("id", "in", ids).where("next_check_at", "<=", ts).execute();
}

// ── Plan limits ──

/** Per-run cache of each owner's entitlements, and pausing of keywords beyond the plan's limit. */
export class PlanGate {
  private readonly entitlements = new Map<number, Promise<Entitlements>>();
  private readonly checkedLimit = new Set<number>();
  private readonly overLimit = new Set<number>();

  get(userId: number): Promise<Entitlements> {
    let e = this.entitlements.get(userId);
    if (!e) this.entitlements.set(userId, (e = getEntitlementsForUserId(userId)));
    return e;
  }

  /**
   * Keywords of the owner beyond the plan's keyword limit (the newest ones) are paused once per
   * run; returns the ids that were paused so the run skips them.
   */
  async enforceLimit(userId: number): Promise<Set<number>> {
    if (this.checkedLimit.has(userId)) return this.overLimit;
    this.checkedLimit.add(userId);
    const ent = await this.get(userId);
    if (ent.maxKeywords <= 0) return this.overLimit;
    const db = await getDb();
    const rows = await db
      .selectFrom("keywords")
      .innerJoin("projects", "projects.id", "keywords.project_id")
      .select(["keywords.id", "keywords.status"])
      .where("projects.user_id", "=", userId)
      .orderBy("keywords.created_at")
      .orderBy("keywords.id")
      .execute();
    if (rows.length <= ent.maxKeywords) return this.overLimit;
    const excess = rows.slice(ent.maxKeywords).filter((r) => r.status === "active").map((r) => r.id);
    for (let i = 0; i < excess.length; i += 500) {
      await db
        .updateTable("keywords")
        .set({ status: "paused", last_error: "Paused: over the plan's keyword limit.", updated_at: nowIso() })
        .where("id", "in", excess.slice(i, i + 500))
        .execute();
    }
    for (const id of excess) this.overLimit.add(id);
    return this.overLimit;
  }
}

// ── Saving a result ──

export interface SavedCheck {
  item: CheckItem;
  transition: Transition;
  hits: RuleHit[];
}

/**
 * Store one check: the day's rankings row (insert or update), the keyword's columns, the
 * day's SERP snapshot. Evaluates the project's alert rules against the previous day of checks
 * and records which fired. Idempotent for the same keyword, day and result.
 */
export async function saveCheck(item: CheckItem, result: RankResult, providerId: string, frequency: "daily" | "weekly", at = Date.now()): Promise<SavedCheck> {
  const db = await getDb();
  const { keyword } = item;
  const day = new Date(at).toISOString().slice(0, 10);
  const checkedAt = new Date(at).toISOString();
  const lastDay = keyword.last_checked_at ? keyword.last_checked_at.slice(0, 10) : null;

  let hasPrevious = false;
  let previous: number | null = null;
  let previousUrl: string | null = null;
  if (lastDay && lastDay < day) {
    hasPrevious = true;
    previous = keyword.last_position === null ? null : Number(keyword.last_position);
    previousUrl = keyword.last_url;
  } else if (lastDay) {
    const row = await db
      .selectFrom("rankings")
      .select(["position", "url"])
      .where("keyword_id", "=", keyword.id)
      .where("day", "<", day)
      .orderBy("day", "desc")
      .limit(1)
      .executeTakeFirst();
    if (row) {
      hasPrevious = true;
      previous = row.position === null ? null : Number(row.position);
      previousUrl = row.url;
    }
  }

  const todayRow = await db.selectFrom("rankings").select(["id", "alerts"]).where("keyword_id", "=", keyword.id).where("day", "=", day).executeTakeFirst();
  const fired = new Set(parseJsonList(todayRow?.alerts ?? null));
  const transition: Transition = { previous, current: result.position, previousUrl, currentUrl: result.url, targetUrl: keyword.target_url };
  const hits = hasPrevious ? evaluateRules(item.project.settings.alertRules, transition, fired) : [];
  for (const h of hits) fired.add(h.key);

  const values = {
    position: result.position,
    url: result.url ? result.url.slice(0, 1000) : null,
    features: JSON.stringify(result.features),
    competitors: JSON.stringify(result.competitors),
    provider: providerId.slice(0, 20),
    checked_at: checkedAt,
    alerts: fired.size ? JSON.stringify([...fired]).slice(0, 255) : null,
  };
  if (todayRow) {
    await db.updateTable("rankings").set(values).where("id", "=", todayRow.id).execute();
  } else {
    try {
      await db.insertInto("rankings").values({ keyword_id: keyword.id, project_id: keyword.project_id, day, ...values }).execute();
    } catch {
      // Inserted by a concurrent check of the same keyword: the last one wins.
      await db.updateTable("rankings").set(values).where("keyword_id", "=", keyword.id).where("day", "=", day).execute();
    }
  }

  const best = keyword.best_position === null ? null : Number(keyword.best_position);
  const cur = result.position;
  await db
    .updateTable("keywords")
    .set({
      last_position: cur,
      best_position: cur === null ? best : best === null ? cur : Math.min(best, cur),
      start_position: keyword.start_position === null ? cur : keyword.start_position,
      last_url: values.url,
      last_features: values.features,
      last_checked_at: checkedAt,
      next_check_at: nextCheckAt(frequency, at),
      fail_count: 0,
      last_error: null,
      updated_at: checkedAt,
    })
    .where("id", "=", keyword.id)
    .execute();

  await db.deleteFrom("serp_snapshots").where("keyword_id", "=", keyword.id).where("checked_at", ">=", `${day}T00:00:00.000Z`).execute();
  await db
    .insertInto("serp_snapshots")
    .values({ keyword_id: keyword.id, checked_at: checkedAt, results: JSON.stringify(result.results.slice(0, SNAPSHOT_SIZE)) })
    .execute();

  return { item, transition, hits };
}

// ── Alerts ──

/** Send the alerts of a run, per project (up to MAX_ALERTS_PER_PROJECT each, the rest summarised). Never throws. */
export async function dispatchAlerts(saved: SavedCheck[], depth: number): Promise<number> {
  const byProject = new Map<number, SavedCheck[]>();
  for (const s of saved) {
    if (!s.hits.length) continue;
    const list = byProject.get(s.item.project.id) ?? [];
    list.push(s);
    byProject.set(s.item.project.id, list);
  }
  let sent = 0;
  await Promise.all(
    [...byProject.values()].map(async (list) => {
      const project = list[0].item.project;
      const pending: Array<{ s: SavedCheck; hit: RuleHit }> = list.flatMap((s) => s.hits.map((hit) => ({ s, hit })));
      const send = async (event: AlertEvent, message: string, data: Record<string, string | number>) => {
        try {
          const payload = await buildAlertPayload({ id: project.id, name: project.name, domain: project.domain }, event, message, data);
          await notifyChannels(project.settings.alertChannelIds, payload, project.id, project.userId);
          sent += 1;
        } catch (error) {
          console.error("[searchzen] rank alert failed:", error);
        }
      };
      for (const { s, hit } of pending.slice(0, MAX_ALERTS_PER_PROJECT)) {
        const k = s.item.keyword;
        const t = s.transition;
        const data: Record<string, string | number> = {
          keyword: k.phrase,
          position: t.current ?? "not ranked",
          previous: t.previous ?? "not ranked",
        };
        if (t.previous !== null && t.current !== null) data.change = t.previous - t.current;
        if (t.currentUrl) data.url = t.currentUrl;
        if (k.target_url) data.target = k.target_url;
        data.location = [countryName(k.country), k.location].filter(Boolean).join(", ");
        data.device = k.device;
        if (hit.rule.type === "enters_top" || hit.rule.type === "leaves_top") data.top = hit.rule.top;
        await send(hit.event, describeHit(hit, k.phrase, t, depth), data);
      }
      const rest = pending.length - MAX_ALERTS_PER_PROJECT;
      if (rest > 0) {
        const phrases = [...new Set(pending.slice(MAX_ALERTS_PER_PROJECT).map((p) => p.s.item.keyword.phrase))];
        await send("rank_changed", `${rest} more ranking alert${rest === 1 ? "" : "s"} in ${project.name}: ${phrases.slice(0, 10).map((p) => `"${p}"`).join(", ")}${phrases.length > 10 ? "…" : ""}`, {
          more: rest,
        });
      }
    }),
  );
  return sent;
}

// ── Running checks ──

export interface RunOptions {
  provider: RankProvider;
  config: RankConfig;
  /** Epoch ms after which no new check starts. */
  deadline: number;
  gate?: PlanGate;
  /** Manual checks ignore the schedule (a keyword checked earlier is checked again). */
  manual?: boolean;
}

/** Run checks for `items` with the provider's concurrency within the deadline. Never throws. */
export async function runChecks(items: CheckItem[], options: RunOptions): Promise<RunSummary> {
  const summary: RunSummary = { checked: 0, failed: 0, skipped: 0, alerts: 0, stopped: null };
  if (!items.length) return summary;
  const gate = options.gate ?? new PlanGate();
  const { provider, config } = options;
  const usage = { requests: 0, errors: 0, credits: 0 };
  const perUser = new Map<number, number>();
  const saved: SavedCheck[] = [];

  // Plan rules first: keywords over the owner's limit are paused; weekly plans don't check daily.
  const runnable: Array<{ item: CheckItem; frequency: "daily" | "weekly" }> = [];
  const reschedule = new Map<string, number[]>();
  for (const item of items) {
    const over = await gate.enforceLimit(item.project.userId);
    if (over.has(item.keyword.id)) {
      summary.skipped += 1;
      continue;
    }
    const ent = await gate.get(item.project.userId);
    const frequency = effectiveFrequency(item.project.settings.checkFrequency, ent.checkFrequency);
    const last = item.keyword.last_checked_at ? Date.parse(item.keyword.last_checked_at) : NaN;
    if (!options.manual && Number.isFinite(last) && Date.now() - last < checkIntervalMs(frequency) * 0.9) {
      // Due early (e.g. the plan changed from daily to weekly): move it to its proper time.
      const at = nextCheckAt(frequency, last);
      reschedule.set(at, [...(reschedule.get(at) ?? []), item.keyword.id]);
      summary.skipped += 1;
      continue;
    }
    runnable.push({ item, frequency });
  }
  for (const [at, ids] of reschedule) await setNextCheck(ids, at);
  if (!runnable.length) return summary;

  if (!options.manual) await claim(runnable.map((r) => r.item.keyword.id));

  let next = 0;
  let stop = false;
  const started = new Set<number>();
  const worker = async () => {
    while (!stop && next < runnable.length && Date.now() < options.deadline) {
      const { item, frequency } = runnable[next++];
      started.add(item.keyword.id);
      const input = {
        phrase: item.keyword.phrase,
        country: item.keyword.country,
        language: item.keyword.language,
        device: (item.keyword.device === "mobile" ? "mobile" : "desktop") as Device,
        location: item.keyword.location,
        depth: config.depth,
        domain: item.project.domain,
        competitors: item.project.settings.competitors,
      };
      try {
        const result = await provider.check(input);
        usage.requests += result.requests;
        usage.credits += result.credits ?? 0;
        perUser.set(item.project.userId, (perUser.get(item.project.userId) ?? 0) + result.requests);
        saved.push(await saveCheck(item, result, provider.id, frequency));
        summary.checked += 1;
      } catch (error) {
        usage.errors += 1;
        summary.failed += 1;
        const kind = error instanceof SerpProviderError ? error.kind : "response";
        const message = (error instanceof Error ? error.message : "The check failed.").slice(0, 480);
        if (!(error instanceof SerpProviderError)) console.error("[searchzen] rank check failed:", error);
        const db = await getDb();
        if (kind === "config" || kind === "quota") {
          // Not the keyword's fault: pause all checks for a while instead of hammering the provider.
          stop = true;
          summary.stopped = message;
          await setRankPause(kind === "config" ? CONFIG_PAUSE_MS : QUOTA_PAUSE_MS, message).catch(() => undefined);
          await db.updateTable("keywords").set({ next_check_at: nowIso(), last_error: message }).where("id", "=", item.keyword.id).execute();
        } else {
          const fails = Number(item.keyword.fail_count ?? 0) + 1;
          const pause = kind === "response" && fails >= PAUSE_AFTER_FAILURES;
          await db
            .updateTable("keywords")
            .set({
              fail_count: fails,
              last_error: message,
              next_check_at: new Date(Date.now() + retryDelayMs(fails)).toISOString(),
              updated_at: nowIso(),
              ...(pause ? { status: "paused" as const } : {}),
            })
            .where("id", "=", item.keyword.id)
            .execute();
        }
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(config.concurrency, runnable.length)) }, worker));
  } finally {
    // Release keywords that were claimed but not started (time budget or a stop).
    const unstarted = runnable.filter((r) => !started.has(r.item.keyword.id)).map((r) => r.item.keyword.id);
    summary.skipped += unstarted.length;
    if (!options.manual) await setNextCheck(unstarted, nowIso()).catch(() => undefined);
    await recordProviderUsage(provider.id, usage).catch((e) => console.error("[searchzen] provider usage:", e));
    for (const [userId, n] of perUser) await incrementUsage(userId, { serpRequests: n }).catch(() => undefined);
  }
  summary.alerts = await dispatchAlerts(saved, config.depth);
  return summary;
}

export type CheckNowError = "no_provider" | "paused";

/** Check keywords right away with the active provider (dashboard "Check now", REST API). */
export async function checkItemsNow(items: CheckItem[], budgetMs = 25_000): Promise<RunSummary & { error?: CheckNowError }> {
  const active = await getActiveProvider();
  if (!active.provider) return { checked: 0, failed: 0, skipped: items.length, alerts: 0, stopped: null, error: "no_provider" };
  if (await getRankPause()) return { checked: 0, failed: 0, skipped: items.length, alerts: 0, stopped: null, error: "paused" };
  return runChecks(items, { provider: active.provider, config: active.config, deadline: Date.now() + budgetMs, manual: true });
}
