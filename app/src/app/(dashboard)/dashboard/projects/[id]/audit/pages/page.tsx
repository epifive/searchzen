import type { Metadata } from "next";
import Link from "next/link";
import { FileSearch, Search } from "lucide-react";
import { AuditNav, auditBase, HttpStatus, issueTitle, TextLink, UrlText } from "@/components/dashboard/audit-kit";
import { DTable, DTd, DTh, Empty, LinkTabs, Pager, Panel } from "@/components/dashboard/ui";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { AUDIT_CHECKS } from "@/lib/audit/checks";
import { listAuditPages, type PageFilters, type PageStatusFilter } from "@/lib/audit/service";
import { intParam } from "@/lib/dash-format";
import { requireProject } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { loadAuditContext } from "../_data";

type Query = { audit?: string; status?: string; issue?: string; q?: string; sort?: string; page?: string };
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Query> };

const PER_PAGE = 50;
const STATUSES: PageStatusFilter[] = ["all", "2xx", "3xx", "4xx", "5xx", "error", "issues"];
const SORTS = ["url", "status", "words", "load", "depth", "inlinks", "issues"] as const;
type Sort = (typeof SORTS)[number];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("dash.nav.audit")} · ${t("audit.nav.pages")}` };
}

export default async function AuditPagesPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const [ctx, t, locale] = await Promise.all([loadAuditContext(id, query.audit), getT(), getLocale()]);
  const { project, selected } = ctx;
  const lc = locale.code;
  const base = auditBase(project.id);
  const done = selected && !selected.pruned && selected.pagesCrawled > 0 && selected.status !== "failed" ? selected : null;

  const status = (STATUSES as string[]).includes(query.status ?? "") ? (query.status as PageStatusFilter) : "all";
  const issue = /^[a-z0-9_]{1,60}$/.test(query.issue ?? "") ? query.issue : undefined;
  const q = (query.q ?? "").slice(0, 200);
  const sort = (SORTS as readonly string[]).includes(query.sort ?? "") ? (query.sort as Sort) : undefined;
  const page = intParam(query.page, 1, 10_000);
  const auditParam = ctx.query ? String(selected?.id) : undefined;

  const href = (patch: Partial<Query>) => {
    const next: Query = { audit: auditParam, status: status === "all" ? undefined : status, issue, q: q || undefined, sort, ...patch };
    const qs = Object.entries(next)
      .filter(([, v]) => v !== undefined && v !== "" && v !== "all")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return `${base}/pages${qs ? `?${qs}` : ""}`;
  };

  const filters: PageFilters = { status, issue, q, sort, limit: PER_PAGE, offset: (page - 1) * PER_PAGE };
  const { total, pages } = done ? await listAuditPages(done.id, filters) : { total: 0, pages: [] };
  const pagesCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const origin = selected?.startUrl ? new URL(selected.startUrl).origin : undefined;
  const issueCodes = done ? Object.keys(done.summary.byCode).filter((c) => AUDIT_CHECKS.some((k) => k.code === c && k.test)) : [];

  const sortTh = (col: Sort, label: string, end = false) => (
    <DTh key={col} className={end ? "text-end" : undefined}>
      <Link href={href({ sort: col, page: undefined })} className={cn("hover:text-ink", sort === col && "text-ink underline underline-offset-4")} title={t("audit.pages.sortBy", { column: label })}>
        {label}
      </Link>
    </DTh>
  );

  return (
    <div className="space-y-6">
      <AuditNav projectId={project.id} active="pages" query={ctx.query} t={t} />
      {!done ? (
        <Panel>
          <Empty icon={<FileSearch />} title={t("audit.emptyTitle")} action={<TextLink href={`${base}${ctx.query}`}>{t("audit.nav.overview")}</TextLink>} />
        </Panel>
      ) : (
        <>
          <div>
            <LinkTabs label={t("audit.pages.statusLabel")} items={STATUSES.map((s) => ({ href: href({ status: s, page: undefined }), label: t(`audit.pages.status.${s}`), active: status === s }))} />
          </div>
          <form method="get" action={`${base}/pages`} className="flex flex-wrap items-end gap-2">
            {auditParam ? <input type="hidden" name="audit" value={auditParam} /> : null}
            {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
            {sort ? <input type="hidden" name="sort" value={sort} /> : null}
            <label className="min-w-0 flex-1 basis-56">
              <span className="sr-only">{t("audit.pages.search")}</span>
              <Input type="search" name="q" defaultValue={q} placeholder={t("audit.pages.search")} dir="auto" />
            </label>
            <label className="min-w-0 basis-56">
              <span className="sr-only">{t("audit.pages.issue")}</span>
              <Select name="issue" defaultValue={issue ?? ""}>
                <option value="">{t("audit.pages.anyIssue")}</option>
                {issueCodes.map((c) => (
                  <option key={c} value={c}>
                    {issueTitle(t, c)}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="outline">
              <Search aria-hidden />
              {t("audit.pages.filter")}
            </Button>
          </form>
          <Panel padded={false}>
            {pages.length ? (
              <>
                <DTable minWidth={760} label={t("audit.nav.pages")}>
                  <thead>
                    <tr>
                      {sortTh("url", t("audit.pages.url"))}
                      {sortTh("status", t("audit.pages.status"))}
                      {sortTh("words", t("audit.pages.words"), true)}
                      {sortTh("load", t("audit.pages.load"), true)}
                      {sortTh("depth", t("audit.pages.depth"), true)}
                      {sortTh("inlinks", t("audit.pages.inlinks"), true)}
                      {sortTh("issues", t("audit.pages.issues"), true)}
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((p) => (
                      <tr key={p.id} className="hover:bg-paper">
                        <DTd className="max-w-[26rem]">
                          <Link href={`${base}/pages/${p.id}${ctx.query}`} className="block min-w-0 hover:text-primary">
                            <UrlText url={p.url} origin={origin} className="block truncate text-sm font-medium" />
                            <span dir="auto" className="block truncate text-xs text-muted">
                              {p.redirectTo ? (
                                <>
                                  → <UrlText url={p.redirectTo} origin={origin} />
                                </>
                              ) : (
                                p.title || (p.contentType && !/html/.test(p.contentType) ? p.contentType : t("audit.pages.noTitle"))
                              )}
                            </span>
                          </Link>
                        </DTd>
                        <DTd>
                          <HttpStatus status={p.statusCode} t={t} />
                        </DTd>
                        <DTd className="text-end tabular-nums">{p.words ? p.words.toLocaleString(lc) : "–"}</DTd>
                        <DTd className="text-end whitespace-nowrap tabular-nums">{t("audit.pages.ms", { n: p.loadMs.toLocaleString(lc) })}</DTd>
                        <DTd className="text-end tabular-nums">{p.depth.toLocaleString(lc)}</DTd>
                        <DTd className="text-end tabular-nums">{p.inlinks.toLocaleString(lc)}</DTd>
                        <DTd className="text-end tabular-nums">
                          {p.issues.length ? <span className="font-semibold text-ink">{p.issues.length.toLocaleString(lc)}</span> : <span className="text-muted">0</span>}
                        </DTd>
                      </tr>
                    ))}
                  </tbody>
                </DTable>
                <Pager
                  page={page}
                  pages={pagesCount}
                  href={(n) => href({ page: n > 1 ? String(n) : undefined })}
                  labels={{
                    summary: t("audit.pages.summary", {
                      from: ((page - 1) * PER_PAGE + 1).toLocaleString(lc),
                      to: Math.min(total, page * PER_PAGE).toLocaleString(lc),
                      total: total.toLocaleString(lc),
                    }),
                    previous: t("audit.pages.previous"),
                    next: t("audit.pages.next"),
                    nav: t("audit.pages.pagination"),
                  }}
                />
              </>
            ) : (
              <Empty icon={<FileSearch />} title={t("audit.pages.empty")} />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
