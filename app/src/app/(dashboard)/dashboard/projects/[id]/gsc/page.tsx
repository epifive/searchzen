import type { Metadata } from "next";
import Link from "next/link";
import { Crown, MousePointerClick, RefreshCw, Unplug } from "lucide-react";
import { disconnectGscAction, importNowAction, unassignPropertyAction } from "@/app/actions/dashboard/gsc";
import { ActionButton } from "@/components/dashboard/actions";
import { CopyField } from "@/components/dashboard/copy";
import { GscChart, GscTables } from "@/components/dashboard/gsc-data";
import { GscPropertyPicker, type PickerGroup } from "@/components/dashboard/gsc-forms";
import { Delta, Kpi, KpiGrid, Num } from "@/components/dashboard/kit";
import { Empty, LinkTabs, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatDay, formatNumber, formatRelative } from "@/lib/dash-format";
import { requireProject } from "@/lib/dashboard";
import { getConnection, getUserConnections, listConnectionSites } from "@/lib/gsc/connections";
import { getGscDaily, getGscTop, hasGscData, lastGscDay, sumDays } from "@/lib/gsc/data";
import { getGoogleCredentials } from "@/lib/gsc/google";
import { readImportState } from "@/lib/gsc/import";
import { propertyMatchesDomain } from "@/lib/gsc/properties";
import { getLocale, getT } from "@/lib/i18n/server";
import { maybeT } from "@/components/dashboard/overview-bits";
import { getDb } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { normalizeKeyword } from "@/seo/normalize";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string; error?: string; connected?: string; change?: string }> };

const PERIODS = [7, 28, 90] as const;
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("dash.nav.gsc")}` };
}

/** Search Console tab: connect Google, pick the property, then clicks / impressions / CTR / position with top queries and pages. */
export default async function GscPage({ params, searchParams }: Props) {
  const { id } = await params;
  const [{ user, project }, t, locale, query] = await Promise.all([requireProject(id), getT(), getLocale(), searchParams]);
  const lc = locale.code;
  const base = `/dashboard/projects/${project.id}/gsc`;
  const [ent, credentials, connections, settings, hasData] = await Promise.all([getEntitlements(user), getGoogleCredentials(), getUserConnections(user.id), getSettings(), hasGscData(project.id)]);
  const notices = (
    <>
      {query.error ? <Alert tone="error">{maybeT(t, `gsc.error.${query.error}`, t("gsc.error.google"))}</Alert> : null}
      {query.connected ? <Alert tone="success">{t("gsc.connected")}</Alert> : null}
    </>
  );
  const connectHref = `/api/gsc/connect?project=${project.id}`;

  // ── Not available on the plan (data imported earlier stays visible below) ──
  if (!ent.allowGsc && !hasData) {
    return (
      <div className="space-y-4">
        {notices}
        <Panel>
          <Empty
            icon={<Crown />}
            title={t("gsc.plan.title")}
            action={
              <ButtonLink href="/pricing" size="sm">
                {t("dash.banner.cta")}
              </ButtonLink>
            }
          >
            {t("gsc.plan.text")}
          </Empty>
        </Panel>
      </div>
    );
  }

  // ── Google sign-in not configured by the administrator ──
  if (!credentials && !project.gscProperty) {
    return (
      <div className="space-y-4">
        {notices}
        <Panel>
          <Empty icon={<MousePointerClick />} title={t("gsc.config.title")}>
            {user.role === "admin" ? t("gsc.config.adminText") : t("gsc.config.text")}
          </Empty>
          {user.role === "admin" ? (
            <div className="mx-auto max-w-xl space-y-3 pb-4">
              <CopyField value={absoluteUrl(settings, "/api/gsc/callback")} label={t("gsc.config.redirect")} />
              <div className="flex justify-center">
                <ButtonLink href="/admin/settings/google" size="sm">
                  {t("gsc.config.open")}
                </ButtonLink>
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    );
  }

  const usable = connections.filter((c) => !c.broken);

  // ── No property yet: connect, then pick ──
  if (!project.gscProperty || query.change) {
    if (!usable.length) {
      return (
        <div className="space-y-4">
          {notices}
          {connections.some((c) => c.broken) ? <Alert tone="warning">{t("gsc.brokenText", { email: connections.find((c) => c.broken)!.email })}</Alert> : null}
          <Panel>
            <Empty
              icon={<MousePointerClick />}
              title={t("gsc.connect.title")}
              action={
                <ButtonLink href={connectHref} prefetch={false}>
                  {t("gsc.connect.button")}
                </ButtonLink>
              }
            >
              {t("gsc.connect.text")}
            </Empty>
            <p className="px-6 pb-5 text-center text-xs text-muted">{t("gsc.connect.privacy")}</p>
          </Panel>
        </div>
      );
    }
    const groups: PickerGroup[] = [];
    const failures: string[] = [];
    for (const c of usable) {
      try {
        const sites = await listConnectionSites(c.id);
        groups.push({
          connectionId: c.id,
          email: c.email,
          sites: sites.map((s) => ({ siteUrl: s.siteUrl, matches: propertyMatchesDomain(s.siteUrl, project.domain) })).sort((a, b) => Number(b.matches) - Number(a.matches) || a.siteUrl.localeCompare(b.siteUrl)),
        });
      } catch {
        failures.push(c.email);
      }
    }
    const total = groups.reduce((n, g) => n + g.sites.length, 0);
    return (
      <div className="space-y-4">
        {notices}
        {failures.length ? <Alert tone="warning">{t("gsc.listFailed", { email: failures.join(", ") })}</Alert> : null}
        <Panel title={t("gsc.picker.title")} description={t("gsc.picker.text", { domain: project.domain })}>
          {total ? (
            <GscPropertyPicker projectId={project.id} groups={groups.filter((g) => g.sites.length)} current={project.gscProperty} />
          ) : (
            <p className="text-sm text-muted">{t("gsc.picker.empty")}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm">
            <span className="text-muted">{t("gsc.accounts", { emails: usable.map((c) => c.email).join(", ") })}</span>
            <Link href={connectHref} prefetch={false} className="font-medium text-primary hover:underline">
              {t("gsc.connectAnother")}
            </Link>
            {project.gscProperty ? (
              <Link href={base} className="ms-auto font-medium text-muted hover:text-ink">
                {t("gsc.cancelChange")}
              </Link>
            ) : null}
          </div>
        </Panel>
      </div>
    );
  }

  // ── Property assigned: the data ──
  const days = PERIODS.find((p) => String(p) === query.days) ?? 28;
  const [connection, state, lastDay, trackedRows] = await Promise.all([
    project.gscConnectionId ? getConnection(project.gscConnectionId) : Promise.resolve(undefined),
    readImportState(project.id),
    lastGscDay(project.id),
    getDb().then((db) => db.selectFrom("keywords").select("phrase").where("project_id", "=", project.id).execute()),
  ]);
  const end = lastDay ?? shift(new Date().toISOString().slice(0, 10), -2);
  const from = shift(end, -(days - 1));
  const [daily, previousDaily, queries, pages] = await Promise.all([
    getGscDaily(project.id, from, end),
    getGscDaily(project.id, shift(from, -days), shift(from, -1)),
    getGscTop(project.id, "query", from, end, 2000),
    getGscTop(project.id, "page", from, end, 1000),
  ]);
  const totals = sumDays(daily);
  const prev = sumDays(previousDaily);
  const demo = project.gscConnectionId === null;
  const backfilling = Boolean(state?.backfillCursor && state.backfillCursor >= state.backfillFrom);
  const pct = (v: number) => `${formatNumber(v * 100, lc, { maximumFractionDigits: 1 })}%`;

  return (
    <div className="space-y-6">
      {notices}
      {connection?.broken ? (
        <Alert tone="error" title={t("gsc.broken")}>
          <p>{t("gsc.brokenText", { email: connection.email })}</p>
          <ButtonLink href={`${connectHref}&hint=${encodeURIComponent(connection.email)}`} prefetch={false} size="sm" className="mt-2">
            {t("gsc.reconnect")}
          </ButtonLink>
        </Alert>
      ) : null}
      {!ent.allowGsc ? <Alert tone="warning">{t("gsc.plan.paused")}</Alert> : null}

      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <bdi dir="ltr" className="truncate">
                {project.gscProperty}
              </bdi>
              {demo ? <Badge tone="warning">{t("gsc.demoData")}</Badge> : null}
              {backfilling ? <Badge tone="primary">{t("gsc.backfilling")}</Badge> : null}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {connection ? `${connection.email} · ` : ""}
              {state?.lastImportAt ? t("gsc.lastImport", { when: formatRelative(state.lastImportAt, lc) }) : demo ? t("gsc.demoText") : t("gsc.waiting")}
              {state?.lastError && !connection?.broken ? <span className="text-red-600 dark:text-red-400"> · {t("gsc.importError", { error: state.lastError })}</span> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!demo && ent.allowGsc && !connection?.broken ? (
              <ActionButton action={importNowAction} fields={{ project_id: project.id }} showSuccess>
                <RefreshCw aria-hidden />
                {t("gsc.importNow")}
              </ActionButton>
            ) : null}
            {usable.length ? (
              <ButtonLink href={`${base}?change=1`} size="sm" variant="outline">
                {t("gsc.changeProperty")}
              </ButtonLink>
            ) : null}
            <ActionButton action={unassignPropertyAction} fields={{ project_id: project.id }} variant="ghost" confirmText={t("gsc.removeConfirm")}>
              <Unplug aria-hidden />
              {t("gsc.remove")}
            </ActionButton>
          </div>
        </div>
      </Panel>

      <LinkTabs label={t("ov.period")} items={PERIODS.map((p) => ({ href: `${base}?days=${p}`, label: t("ov.lastDays", { n: p }), active: p === days }))} />

      <KpiGrid className="grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("gsc.metric.clicks")} value={<Num value={totals.clicks} locale={lc} />} delta={<Delta current={totals.clicks} previous={prev.clicks} label={t("ov.vsPrevious")} />} />
        <Kpi label={t("gsc.metric.impressions")} value={<Num value={totals.impressions} locale={lc} />} delta={<Delta current={totals.impressions} previous={prev.impressions} label={t("ov.vsPrevious")} />} />
        <Kpi label={t("gsc.metric.ctr")} value={<bdi>{pct(totals.ctr)}</bdi>} hint={prev.impressions ? t("ov.kpi.was", { value: pct(prev.ctr) }) : undefined} />
        <Kpi
          label={t("gsc.metric.position")}
          value={<bdi>{totals.position === null ? "–" : formatNumber(totals.position, lc, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</bdi>}
          hint={prev.position !== null ? t("ov.kpi.was", { value: formatNumber(prev.position, lc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : undefined}
        />
      </KpiGrid>

      <Panel title={t("gsc.chartTitle")} description={t("gsc.chartText", { from: formatDay(from, lc), to: formatDay(end, lc) })}>
        <GscChart days={daily} locale={lc} />
      </Panel>

      <Panel title={t("gsc.tablesTitle")} description={t("gsc.tablesText")} padded={false}>
        <GscTables
          projectId={project.id}
          queries={queries}
          pages={pages}
          tracked={trackedRows.map((r) => normalizeKeyword(r.phrase))}
          locale={lc}
          canTrack
          fileBase={`${project.domain}-gsc-${from}-${end}`}
        />
      </Panel>

      {connections.length ? (
        <Panel title={t("gsc.accountsTitle")} description={t("gsc.accountsText")} padded={false}>
          <ul className="divide-y divide-line">
            {connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium" dir="ltr">
                  {c.email}
                </span>
                {c.broken ? <Badge tone="danger">{t("gsc.broken")}</Badge> : <Badge tone="success">{t("gsc.ok")}</Badge>}
                <ActionButton action={disconnectGscAction} fields={{ connection_id: c.id }} variant="ghost" confirmText={t("gsc.disconnectConfirm", { email: c.email })}>
                  {t("gsc.disconnect")}
                </ActionButton>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
