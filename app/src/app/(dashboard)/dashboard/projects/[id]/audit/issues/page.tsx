import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ListChecks } from "lucide-react";
import { AuditNav, auditBase, IssueDetails, issueText, issueTitle, SeverityBadge, TextLink, UrlText } from "@/components/dashboard/audit-kit";
import { Empty, LinkTabs, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { listAuditIssues, type AuditIssueItem } from "@/lib/audit/service";
import { compareCodes, severityOf, SITE_CHECK_CODES } from "@/lib/audit/checks";
import { requireProject } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/messages";
import { ISSUE_CATEGORIES, SEVERITIES, type IssueCategory, type Severity } from "@/seo/types";
import { loadAuditContext } from "../_data";

type Query = { audit?: string; severity?: string; change?: string; category?: string; code?: string };
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Query> };

const SHOWN_PER_ISSUE = 50;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("dash.nav.audit")} · ${t("audit.nav.issues")}` };
}

export default async function AuditIssuesPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [ctx, t, locale] = await Promise.all([loadAuditContext(id, query.audit), getT(), getLocale()]);
  const { project, selected } = ctx;
  const lc = locale.code;
  const base = auditBase(project.id);
  const done = selected?.status === "done" && !selected.pruned ? selected : null;

  const severity = (SEVERITIES as readonly string[]).includes(query.severity ?? "") ? (query.severity as Severity) : undefined;
  const category = (ISSUE_CATEGORIES as readonly string[]).includes(query.category ?? "") ? (query.category as IssueCategory) : undefined;
  const change = query.change === "new" || query.change === "fixed" ? query.change : "all";
  const openCode = /^[a-z0-9_]{1,60}$/.test(query.code ?? "") ? query.code : undefined;

  const href = (patch: Partial<Query>) => {
    const next = { audit: ctx.query ? selected?.id : undefined, severity, category, change: change === "all" ? undefined : change, ...patch };
    const qs = Object.entries(next)
      .filter(([, v]) => v !== undefined && v !== "" && v !== "all")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return `${base}/issues${qs ? `?${qs}` : ""}`;
  };

  let groups: Array<{ code: string; severity: Severity; items: AuditIssueItem[] }> = [];
  if (done && !(change !== "all" && !done.diff)) {
    const { issues } = await listAuditIssues(done.id, { severity, category, change, limit: 5000 });
    const map = new Map<string, AuditIssueItem[]>();
    for (const i of issues) map.set(i.code, [...(map.get(i.code) ?? []), i]);
    groups = [...map.entries()].map(([code, items]) => ({ code, severity: severityOf(code), items })).sort((a, b) => compareCodes(a.code, b.code));
  }
  const counts = done?.summary;
  const origin = selected?.startUrl ? new URL(selected.startUrl).origin : undefined;

  return (
    <div className="space-y-6">
      <AuditNav projectId={project.id} active="issues" query={ctx.query} t={t} />
      {!done ? (
        <Panel>
          <Empty icon={<ListChecks />} title={t("audit.emptyTitle")} action={<TextLink href={`${base}${ctx.query}`}>{t("audit.nav.overview")}</TextLink>} />
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <LinkTabs
              label={t("audit.issues.severity")}
              items={[
                { href: href({ severity: undefined }), label: t("audit.issues.all"), active: !severity, count: counts ? counts.critical + counts.warning + counts.notice : undefined },
                ...SEVERITIES.map((s) => ({ href: href({ severity: s }), label: t(`seo.severity.${s}`), active: severity === s, count: counts?.[s] })),
              ]}
            />
            {done.diff ? (
              <LinkTabs
                label={t("audit.issues.change")}
                items={[
                  { href: href({ change: undefined }), label: t("audit.issues.allChanges"), active: change === "all" },
                  { href: href({ change: "new" }), label: t("audit.issues.new"), active: change === "new", count: done.diff.newIssues },
                  { href: href({ change: "fixed" }), label: t("audit.issues.fixed"), active: change === "fixed", count: done.diff.fixedIssues },
                ]}
              />
            ) : null}
          </div>
          <LinkTabs
            label={t("audit.issues.category")}
            items={[
              { href: href({ category: undefined }), label: t("audit.issues.allCategories"), active: !category },
              ...ISSUE_CATEGORIES.map((c) => ({ href: href({ category: c }), label: t(`audit.category.${c}`), active: category === c })),
            ]}
          />
          {change !== "all" && !done.diff ? <Alert tone="info">{t("audit.issues.noPrevious")}</Alert> : null}

          {groups.length ? (
            <div className="space-y-3">
              {groups.map((g) => {
                const site = SITE_CHECK_CODES.has(g.code);
                const pages = g.items.filter((i) => i.url);
                const newCount = change === "all" ? g.items.filter((i) => i.isNew).length : 0;
                const help = issueText(t, g.code, "help");
                const fix = issueText(t, g.code, "fix");
                const pageHref = (pageId: number) => `${base}/pages/${pageId}${change === "fixed" && done.diff ? `?audit=${done.diff.previousAuditId}` : ctx.query}`;
                return (
                  <details key={g.code} id={g.code} open={openCode === g.code} className="group scroll-mt-24 rounded-xl border border-line bg-surface">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5 sm:px-5 [&::-webkit-details-marker]:hidden">
                      <SeverityBadge severity={g.severity} t={t} />
                      <span className="min-w-0 flex-1 text-sm font-semibold">{issueTitle(t, g.code)}</span>
                      <span className="flex items-center gap-2">
                        {newCount ? <Badge tone="danger">{t("audit.newIssues", { n: newCount.toLocaleString(lc) })}</Badge> : null}
                        {change === "fixed" ? <Badge tone="success">{t("audit.issues.fixed")}</Badge> : null}
                        <span dir="auto" className="text-sm whitespace-nowrap text-muted">
                          {site ? t("audit.issues.site") : plural(t, "audit.issues.pages", g.items.length, { n: g.items.length.toLocaleString(lc) })}
                        </span>
                        <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden />
                      </span>
                    </summary>
                    <div className="space-y-4 border-t border-line px-4 py-4 sm:px-5">
                      <div className="grid gap-4 text-sm md:grid-cols-2">
                        {help ? (
                          <div>
                            <p className="font-medium">{t("audit.issues.why")}</p>
                            <p className="mt-1 text-muted">{help}</p>
                          </div>
                        ) : null}
                        {fix ? (
                          <div>
                            <p className="font-medium">{t("audit.issues.how")}</p>
                            <p className="mt-1 text-muted">{fix}</p>
                          </div>
                        ) : null}
                      </div>
                      {site ? (
                        g.items[0] ? <IssueDetails details={g.items[0].details} t={t} locale={lc} /> : null
                      ) : (
                        <div>
                          <p className="text-sm font-medium">{change === "fixed" ? t("audit.issues.fixedOn") : t("audit.issues.affected")}</p>
                          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                            {pages.slice(0, SHOWN_PER_ISSUE).map((i) => (
                              <li key={i.id} className="flex flex-col gap-1 px-3 py-2.5">
                                <span className="flex min-w-0 items-start gap-2">
                                  {i.isNew && change === "all" ? <Badge tone="danger">{t("audit.issues.new")}</Badge> : null}
                                  <Link href={pageHref(i.pageId!)} className="min-w-0 text-sm font-medium hover:text-primary">
                                    <UrlText url={i.url!} origin={origin} />
                                  </Link>
                                </span>
                                <IssueDetails details={i.details} t={t} locale={lc} />
                              </li>
                            ))}
                          </ul>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                            {pages.length > SHOWN_PER_ISSUE ? <span>{t("audit.issues.more", { n: (pages.length - SHOWN_PER_ISSUE).toLocaleString(lc) })}</span> : <span />}
                            {change !== "fixed" ? <TextLink href={`${base}/pages?issue=${g.code}${ctx.query ? `&${ctx.query.slice(1)}` : ""}`}>{t("audit.issues.showInPages")}</TextLink> : null}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <Panel>
              <Empty icon={<ListChecks />} title={severity || category || change !== "all" ? t("audit.issues.emptyTitle") : t("audit.issues.cleanTitle")} />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
