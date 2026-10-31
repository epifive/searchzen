import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/dash-format";
import type { Translator } from "@/lib/i18n/messages";
import type { RankStatus } from "@/lib/rank/status";

/** Notices above the rank tracking pages: no provider configured, checks paused, simulated data. */
export function RankNotices({ status, isAdmin, t, locale }: { status: RankStatus; isAdmin: boolean; t: Translator; locale: string }) {
  const settings = (
    <Link href="/admin/settings/rank-tracking" className="font-medium underline underline-offset-2">
      {t("rank.notice.openSettings")}
    </Link>
  );
  if (status.problem) {
    return (
      <Alert tone="warning">
        {isAdmin ? (
          <>
            {status.problem === "no_key" ? t("rank.notice.noKeyAdmin") : status.problem === "simulated_off" ? t("rank.notice.simulatedOffAdmin") : t("rank.notice.noProviderAdmin")} {settings}
          </>
        ) : (
          t("rank.notice.noProvider")
        )}
      </Alert>
    );
  }
  if (status.pause) {
    return (
      <Alert tone="warning">
        {t("rank.notice.paused", { time: formatDateTime(status.pause.until, locale) })}
        {isAdmin ? (
          <>
            {" "}
            <bdi dir="auto">{status.pause.reason}</bdi> {settings}
          </>
        ) : null}
      </Alert>
    );
  }
  if (status.simulated) return <Alert tone="info">{t("rank.notice.simulated")}</Alert>;
  return null;
}
