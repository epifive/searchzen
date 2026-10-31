import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Eye, Mail, Pause, Play, Send, Trash2 } from "lucide-react";
import { deleteScheduleAction, sendReportNowAction, toggleScheduleAction } from "@/app/actions/dashboard/reports";
import { ActionButton } from "@/components/dashboard/actions";
import { CopyField } from "@/components/dashboard/copy";
import { AddScheduleForm } from "@/components/dashboard/report-forms";
import { ShareControls } from "@/components/dashboard/settings-forms";
import { Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/dash-format";
import { requireProject } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { mailConfigured } from "@/lib/mail";
import { getEntitlements } from "@/lib/plans";
import { baseUrl } from "@/lib/request";
import { listSchedules, MAX_RECIPIENTS, MAX_SCHEDULES } from "@/lib/reports/schedules";
import { getSettings } from "@/lib/settings";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("dash.nav.reports")}` };
}

/** Reports tab: the shared client report, scheduled report emails and the SEO health badge. */
export default async function ReportsPage({ params }: Props) {
  const { id } = await params;
  const [{ user, project }, t, locale, origin] = await Promise.all([requireProject(id), getT(), getLocale(), baseUrl()]);
  const [schedules, settings, ent] = await Promise.all([listSchedules(project.id), getSettings(), getEntitlements(user)]);
  const lc = locale.code;
  const mailReady = mailConfigured(settings);
  const shareUrl = project.shareToken ? `${origin}/r/${project.shareToken}` : null;
  const scriptSnippet = project.shareToken ? `<script async src="${origin}/sz-badge.js" data-project="${project.shareToken}"></script>` : "";
  const imgSnippet = project.shareToken ? `<a href="${shareUrl}"><img src="${origin}/api/badge/${project.shareToken}.svg" alt="${t("rep.badge.label")}" height="20"></a>` : "";

  return (
    <div className="space-y-6">
      <Panel
        title={t("rep.tab.reportTitle")}
        description={t("rep.tab.reportText")}
        actions={
          <ButtonLink href={`/r/preview/${project.id}`} target="_blank" size="sm" variant="outline" prefetch={false}>
            <Eye aria-hidden />
            {t("rep.tab.preview")}
          </ButtonLink>
        }
      >
        <div className="space-y-4">
          <ShareControls projectId={project.id} url={shareUrl} />
          <p className="text-xs text-muted">
            {project.settings.sharePasswordHash ? t("rep.password.on") : t("rep.password.offText")}{" "}
            <Link href={`/dashboard/projects/${project.id}/settings#sharing`} className="font-medium text-primary hover:underline">
              {t("rep.tab.passwordLink")}
            </Link>
            {" · "}
            <Link href={`/dashboard/projects/${project.id}/settings#branding`} className="font-medium text-primary hover:underline">
              {ent.allowWhiteLabel ? t("rep.tab.brandingLink") : t("rep.tab.brandingUpgrade")}
            </Link>
          </p>
        </div>
      </Panel>

      <Panel
        title={t("rep.sched.title")}
        description={t("rep.sched.text")}
        actions={
          <ActionButton action={sendReportNowAction} fields={{ project_id: project.id }} showSuccess className="items-end">
            <Send aria-hidden />
            {t("rep.sched.test")}
          </ActionButton>
        }
      >
        {!mailReady ? (
          <Alert tone="warning" className="mb-4">
            {t("rep.sched.noMail")}
          </Alert>
        ) : null}
        {schedules.length ? (
          <ul className="mb-6 divide-y divide-line rounded-lg border border-line">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <CalendarClock className="size-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {t(s.frequency === "monthly" ? "rep.sched.monthly" : "rep.sched.weekly")}
                    {s.isActive ? null : <Badge tone="neutral">{t("rep.sched.pausedBadge")}</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted" dir="ltr" title={s.recipients.join(", ")}>
                    {s.recipients.join(", ")}
                  </p>
                  <p className="text-xs text-muted">
                    {s.isActive ? t("rep.sched.next", { when: formatDateTime(s.nextSendAt, lc) }) : null}
                    {s.lastSentAt ? ` · ${t("rep.sched.last", { when: formatRelative(s.lastSentAt, lc) })}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <ActionButton action={sendReportNowAction} fields={{ project_id: project.id, schedule_id: s.id }} variant="ghost" label={t("rep.sched.sendNow")} confirmText={t("rep.sched.sendConfirm", { n: s.recipients.length })}>
                    <Mail aria-hidden />
                  </ActionButton>
                  <ActionButton action={toggleScheduleAction} fields={{ project_id: project.id, schedule_id: s.id }} variant="ghost" label={s.isActive ? t("rep.sched.pause") : t("rep.sched.resume")}>
                    {s.isActive ? <Pause aria-hidden /> : <Play aria-hidden />}
                  </ActionButton>
                  <ActionButton action={deleteScheduleAction} fields={{ project_id: project.id, schedule_id: s.id }} variant="ghost" label={t("rep.sched.delete")} confirmText={t("rep.sched.deleteConfirm")}>
                    <Trash2 aria-hidden />
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={<CalendarClock />} title={t("rep.sched.emptyTitle")}>
            {t("rep.sched.emptyText")}
          </Empty>
        )}
        {schedules.length < MAX_SCHEDULES ? <AddScheduleForm projectId={project.id} max={MAX_RECIPIENTS} /> : <p className="text-sm text-muted">{t("rep.sched.err.count", { n: MAX_SCHEDULES })}</p>}
      </Panel>

      <Panel id="badge" title={t("rep.badge.title")} description={t("rep.badge.text")}>
        {project.shareToken ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-paper p-4">
              <span className="text-xs text-muted">{t("rep.badge.preview")}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/badge/${project.shareToken}.svg`} alt={t("rep.badge.label")} height={20} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/badge/${project.shareToken}.svg?theme=dark`} alt={t("rep.badge.label")} height={20} />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("rep.badge.script")}</p>
              <CopyField value={scriptSnippet} label={t("rep.badge.script")} multiline />
              <p className="mt-1.5 text-xs text-muted">{t("rep.badge.scriptHint")}</p>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("rep.badge.image")}</p>
              <CopyField value={imgSnippet} label={t("rep.badge.image")} multiline />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{t("rep.badge.needsSharing")}</p>
        )}
      </Panel>
    </div>
  );
}
