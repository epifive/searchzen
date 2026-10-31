import { positionChange } from "@/seo/normalize";
import type { AlertEvent, AlertRule } from "@/seo/types";

/**
 * Rank alert rules evaluated on a position transition (dependency-free, unit-tested).
 *
 * The rank job compares the keyword's position on its previous day of checks with the new one,
 * and passes the rule keys already fired for the keyword today: a rule fires at most once per
 * keyword and day, however often the keyword is re-checked ("Check now"), and fires again on a
 * later day only when the transition happens again.
 */

export interface Transition {
  /** Position at the previous check before today (null = not ranked). */
  previous: number | null;
  current: number | null;
  previousUrl: string | null;
  currentUrl: string | null;
  /** The keyword's target URL (null = none). */
  targetUrl: string | null;
}

export interface RuleHit {
  /** Stable rule key, e.g. "enters_top:10" (stored in rankings.alerts). */
  key: string;
  rule: AlertRule;
  event: AlertEvent;
}

export function ruleKey(rule: AlertRule): string {
  switch (rule.type) {
    case "enters_top":
    case "leaves_top":
      return `${rule.type}:${rule.top}`;
    case "change":
      return `change:${rule.min}`;
    case "url_lost":
      return "url_lost";
  }
}

const EVENT: Record<AlertRule["type"], AlertEvent> = {
  enters_top: "rank_entered_top",
  leaves_top: "rank_left_top",
  change: "rank_changed",
  url_lost: "rank_url_lost",
};

/** Two URLs point at the same page (scheme, "www.", trailing slash and fragment ignored). */
export function sameUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const key = (u: string) =>
    u
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/#.*$/, "")
      .replace(/\/+$/, "");
  return key(a) === key(b);
}

/** Does the rule match this transition (ignoring whether it already fired today)? */
export function ruleMatches(rule: AlertRule, t: Transition): boolean {
  const { previous: prev, current: cur } = t;
  switch (rule.type) {
    case "enters_top":
      return cur !== null && cur <= rule.top && (prev === null || prev > rule.top);
    case "leaves_top":
      return prev !== null && prev <= rule.top && (cur === null || cur > rule.top);
    case "change": {
      const change = positionChange(prev, cur);
      return change.delta !== null && Math.abs(change.delta) >= rule.min;
    }
    case "url_lost":
      return Boolean(t.targetUrl) && prev !== null && sameUrl(t.previousUrl, t.targetUrl) && !sameUrl(t.currentUrl, t.targetUrl);
  }
}

/** Rules that fire for a transition, skipping those already fired today (`fired` keys). */
export function evaluateRules(rules: AlertRule[], t: Transition, fired: ReadonlySet<string> = new Set()): RuleHit[] {
  const out: RuleHit[] = [];
  for (const rule of rules) {
    const key = ruleKey(rule);
    if (fired.has(key) || out.some((h) => h.key === key)) continue;
    if (ruleMatches(rule, t)) out.push({ key, rule, event: EVENT[rule.type] });
  }
  return out;
}

const pos = (p: number | null, depth: number) => (p === null ? `not in the top ${depth}` : `#${p}`);

/** One-line English summary for the alert channels (alerts are written in English, like webhooks). */
export function describeHit(hit: RuleHit, phrase: string, t: Transition, depth: number): string {
  const q = `"${phrase}"`;
  switch (hit.rule.type) {
    case "enters_top":
      return `${q} entered the top ${hit.rule.top}: now ${pos(t.current, depth)} (was ${pos(t.previous, depth)}).`;
    case "leaves_top":
      return `${q} dropped out of the top ${hit.rule.top}: now ${pos(t.current, depth)} (was ${pos(t.previous, depth)}).`;
    case "change": {
      const delta = (t.previous ?? 0) - (t.current ?? 0);
      return `${q} moved from ${t.previous} to ${t.current} (${delta > 0 ? "+" : ""}${delta}).`;
    }
    case "url_lost":
      return t.current === null
        ? `The target URL of ${q} no longer ranks: the keyword is ${pos(null, depth)}.`
        : `The target URL of ${q} no longer ranks: ${t.currentUrl ?? "another page"} ranks at #${t.current} instead.`;
  }
}
