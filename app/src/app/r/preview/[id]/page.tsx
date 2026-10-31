import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReportView } from "@/components/dashboard/report-view";
import { HtmlLang } from "@/components/site/html-lang";
import { getCurrentUser } from "@/lib/auth/session";
import { getLocale, getT } from "@/lib/i18n/server";
import { getOwnedProject } from "@/lib/projects";
import { buildReport, reportPeriod } from "@/lib/reports/data";

/** The owner's preview of a project's client report (works while sharing is off). */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ days?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("rep.view.previewTitle"), robots: { index: false, follow: false } };
}

export default async function ReportPreviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/r/preview/${id}`)}`);
  const project = await getOwnedProject(/^\d{1,10}$/.test(id) ? Number(id) : NaN, user.id);
  if (!project) redirect("/dashboard");
  const [t, locale, query] = await Promise.all([getT(), getLocale(), searchParams]);
  const data = await buildReport(project, reportPeriod(query.days));
  return (
    <main dir={locale.dir} lang={locale.code} className="min-h-dvh bg-paper print:bg-white">
      <HtmlLang code={locale.code} dir={locale.dir} />
      <ReportView data={data} t={t} locale={locale.code} basePath={`/r/preview/${project.id}`} preview />
    </main>
  );
}
