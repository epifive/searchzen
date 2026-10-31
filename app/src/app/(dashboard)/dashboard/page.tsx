import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, Plus, Search } from "lucide-react";
import { Num } from "@/components/dashboard/kit";
import { ScorePill } from "@/components/dashboard/overview-bits";
import { Sparkline } from "@/components/dashboard/overview-chart";
import { CreateProjectForm } from "@/components/dashboard/project-forms";
import { DigestToggle } from "@/components/dashboard/settings-forms";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { formatNumber, formatRelative } from "@/lib/dash-format";
import { requireDashboardUser } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/messages";
import { mailConfigured } from "@/lib/mail";
import { getProjectCards } from "@/lib/overview";
import { atLimit, getEntitlements } from "@/lib/plans";
import { getUserProjects } from "@/lib/projects";
import { isDigestOptedOut } from "@/lib/reports/digest-prefs";
import { getSettings } from "@/lib/settings";
import { countryOptions, formatAveragePosition, languageOptions } from "@/seo/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.overview.title") };
}

type Props = { searchParams: Promise<{ deleted?: string }> };

/** Account overview: a card per project (30-day visibility sparkline and headline numbers), the create form and the digest switch. */
export default async function DashboardOverview({ searchParams }: Props) {
  const user = await requireDashboardUser();
  const [t, locale, projects, entitlements, query] = await Promise.all([getT(), getLocale(), getUserProjects(user.id), getEntitlements(user), searchParams]);
  const lc = locale.code;
  const form = (
    <CreateProjectForm countries={countryOptions(lc)} languages={languageOptions(lc)} defaults={{ country: "US", language: lc === "en" ? "en" : lc }} />
  );

  if (!projects.length) {
    return (
      <div className="mx-auto max-w-3xl py-4 sm:py-10">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
            <Search className="size-6" aria-hidden />
          </span>
          <h1 className="text-3xl font-bold" dir="auto">
            {t("dash.onboarding.title", { name: user.name.split(" ")[0] || user.name })}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-muted">{t("dash.onboarding.text")}</p>
        </div>
        <ol className="mb-8 grid gap-3 sm:grid-cols-3">
          {(["dash.onboarding.step1", "dash.onboarding.step2", "dash.onboarding.step3"] as const).map((key, i) => (
            <li key={key} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-white">{i + 1}</span>
              <span className="pt-1">{t(key)}</span>
            </li>
          ))}
        </ol>
        <Panel title={t("dash.projects.createTitle")} description={t("dash.projects.createText")} id="new-project">
          {form}
        </Panel>
      </div>
    );
  }

  const full = atLimit(projects.length, entitlements.maxProjects);
  const [cards, settings, optedOut] = await Promise.all([getProjectCards(projects), getSettings(), isDigestOptedOut(user.id)]);
  const digestBlocked = !settings.digest_enabled ? t("digest.platformOff") : !mailConfigured(settings) ? t("digest.noMail") : undefined;

  return (
    <>
      <DashHeader
        title={t("dash.overview.title")}
        description={plural(t, "dash.overview.count", projects.length, { n: projects.length })}
        actions={
          full ? (
            <ButtonLink href="/pricing" variant="outline">
              {t("dash.projects.upgrade")}
            </ButtonLink>
          ) : (
            <ButtonLink href="#new-project">
              <Plus aria-hidden />
              {t("dash.projects.add")}
            </ButtonLink>
          )
        }
      />
      {query.deleted ? (
        <Alert tone="success" className="mb-5">
          {t("dash.projects.deleted")}
        </Alert>
      ) : null}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => {
          const c = cards.get(project.id);
          const cells: Array<[string, React.ReactNode]> = [
            [t("ov.kpi.visibility"), <bdi key="v">{formatNumber(c?.visibility ?? 0, lc, { maximumFractionDigits: 1 })}%</bdi>],
            [t("ov.grid.avgPosition"), <bdi key="a">{formatAveragePosition(c?.averagePosition ?? null, lc)}</bdi>],
            [
              t("ov.grid.movement"),
              <span key="m" className="inline-flex items-center gap-2 text-sm">
                <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400">
                  <ArrowUp className="size-3.5" aria-hidden />
                  <Num value={c?.up ?? 0} locale={lc} />
                  <span className="sr-only">{t("ov.up")}</span>
                </span>
                <span className="inline-flex items-center text-red-600 dark:text-red-400">
                  <ArrowDown className="size-3.5" aria-hidden />
                  <Num value={c?.down ?? 0} locale={lc} />
                  <span className="sr-only">{t("ov.down")}</span>
                </span>
              </span>,
            ],
          ];
          return (
            <li key={project.id} className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-colors hover:border-primary-line">
              <div className="flex items-start gap-3 p-5 pb-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-base font-bold text-primary uppercase" aria-hidden>
                  {project.name.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-sans text-base font-semibold tracking-normal">
                    <Link href={`/dashboard/projects/${project.id}`} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none" dir="auto">
                      {project.name}
                    </Link>
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-muted" dir="ltr">
                    {project.domain}
                  </p>
                </div>
                {project.status === "paused" ? (
                  <Badge tone="neutral">{t("dash.projects.paused")}</Badge>
                ) : (
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <ScorePill score={c?.score ?? null} label={t("dash.home.health")} />
                    <span className="text-[11px] text-muted">{c?.score === null || c?.score === undefined ? t("dash.home.noAudit") : t("dash.home.health")}</span>
                  </span>
                )}
              </div>
              <div className="px-5 pb-3">
                <Sparkline values={c?.spark ?? []} label={t("ov.grid.spark")} />
              </div>
              <dl className="grid grid-cols-3 gap-px border-t border-line bg-line">
                {cells.map(([label, value]) => (
                  <div key={label} className="min-w-0 bg-surface px-4 py-3">
                    <dt className="truncate text-[11px] font-medium tracking-wide text-muted uppercase">{label}</dt>
                    <dd className="mt-0.5 truncate text-base font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="flex items-center justify-between gap-2 border-t border-line px-5 py-2.5 text-xs text-muted">
                <span>{plural(t, "ov.grid.keywords", c?.keywords ?? 0, { n: formatNumber(c?.keywords ?? 0, lc) })}</span>
                <span>{c?.lastActivity ? t("ov.grid.activity", { when: formatRelative(c.lastActivity, lc) }) : t("ov.grid.noActivity")}</span>
              </p>
            </li>
          );
        })}
      </ul>
      {full ? (
        <Alert tone="info" className="mt-6">
          {plural(t, "dash.projects.limitReached", entitlements.maxProjects)}
        </Alert>
      ) : (
        <Panel title={t("dash.projects.createTitle")} description={t("dash.projects.createText")} id="new-project" className="mt-8">
          {form}
        </Panel>
      )}
      <Panel id="digest" title={t("digest.title")} className="mt-6">
        <DigestToggle enabled={!optedOut} disabledText={digestBlocked} />
      </Panel>
    </>
  );
}
