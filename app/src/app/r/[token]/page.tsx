import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ReportGate } from "@/components/dashboard/report-gate";
import { ReportView } from "@/components/dashboard/report-view";
import { HtmlLang } from "@/components/site/html-lang";
import { getLocale, getT } from "@/lib/i18n/server";
import { getProjectByShareToken } from "@/lib/projects";
import { buildReport, reportPeriod } from "@/lib/reports/data";
import { isUnlocked, unlockCookieName } from "@/lib/reports/share";

/** Public client report /r/<share token>: optional password, never indexed. */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ days?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const [project, t] = await Promise.all([getProjectByShareToken(token), getT()]);
  return {
    title: project ? t("rep.view.title", { name: project.name }) : t("rep.gate.gone"),
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    referrer: "no-referrer",
  };
}

export default async function SharedReportPage({ params, searchParams }: Props) {
  const { token } = await params;
  const [project, t, locale, query, jar] = await Promise.all([getProjectByShareToken(token), getT(), getLocale(), searchParams, cookies()]);
  if (!project) notFound();
  const lang = <HtmlLang code={locale.code} dir={locale.dir} />;
  if (!(await isUnlocked(token, project.settings.sharePasswordHash, jar.get(unlockCookieName(token))?.value))) {
    return (
      <div dir={locale.dir} lang={locale.code}>
        {lang}
        <ReportGate
          token={token}
          labels={{ title: t("rep.gate.title"), text: t("rep.gate.text"), password: t("rep.gate.password"), submit: t("rep.gate.submit"), checking: t("rep.gate.checking") }}
        />
      </div>
    );
  }
  const data = await buildReport(project, reportPeriod(query.days));
  return (
    <main dir={locale.dir} lang={locale.code} className="min-h-dvh bg-paper print:bg-white">
      {lang}
      <ReportView data={data} t={t} locale={locale.code} basePath={`/r/${token}`} />
    </main>
  );
}
