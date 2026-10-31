import { MESSAGES, type MessageKey, type Translator } from "@/lib/i18n/messages";
import { parseLogEvent } from "@/lib/alerts/format";
import { cn } from "@/lib/utils";
import { changeTone, formatChange, formatPosition, scoreTone } from "@/seo/format";
import type { PositionChange } from "@/seo/normalize";

/** Server-safe pieces shared by the overview, the projects grid, the GSC tab and reports. */

/** A message key that may not exist (issue codes, alert events): the translation, else `fallback`. */
export function maybeT(t: Translator, key: string, fallback: string): string {
  return key in MESSAGES ? t(key as MessageKey) : fallback;
}

/** Title of an audit issue code ("title_missing" → "Missing title" via audit.issue.<code>). */
export function issueTitle(t: Translator, code: string): string {
  const plain = code.replace(/_/g, " ");
  return maybeT(t, `audit.issue.${code}`, plain.charAt(0).toUpperCase() + plain.slice(1));
}

/** Label of an alert_log event ("rank_entered_top:3" → "Keyword entered the top 3"). */
export function eventLabel(t: Translator, stored: string): string {
  const { event, top } = parseLogEvent(stored);
  if (top !== null && event === "rank_entered_top") return t("ov.event.rank_entered_top_n", { n: top });
  if (top !== null && event === "rank_left_top") return t("ov.event.rank_left_top_n", { n: top });
  return maybeT(t, `ov.event.${event}`, event.replace(/_/g, " "));
}

/** "▲ 8" / "▼ 3" / "new" coloured by direction. */
export function ChangeText({ change, t, className }: { change: PositionChange; t: Translator; className?: string }) {
  const text = formatChange(change, { new: t("seo.new"), lost: t("seo.lost") });
  if (!text) return null;
  return <bdi className={cn("text-xs font-semibold whitespace-nowrap tabular-nums", changeTone(change), className)}>{text}</bdi>;
}

export function PositionText({ position, locale }: { position: number | null; locale: string }) {
  return <bdi className="tabular-nums">{formatPosition(position, { locale })}</bdi>;
}

/** Health score pill ("82", coloured good / fair / poor). */
export function ScorePill({ score, label, className }: { score: number | null; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums", scoreTone(score), className)} title={label}>
      {score === null ? "–" : score}
    </span>
  );
}
