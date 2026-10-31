import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { auditBase, Fact, HttpStatus, IssueDetails, issueText, issueTitle, SeverityBadge, TextLink, UrlText } from "@/components/dashboard/audit-kit";
import { Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getAuditPageDetail } from "@/lib/audit/service";
import { formatDateTime } from "@/lib/dash-format";
import { requireProject } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { loadAuditContext } from "../../_data";

type Props = { params: Promise<{ id: string; pageId: string }>; searchParams: Promise<{ audit?: string }> };

const LIST_MAX = 50;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("dash.nav.audit")} · ${t("audit.nav.pages")}` };
}

function UrlList({ urls, origin, empty, t, locale }: { urls: string[]; origin?: string; empty: string; t: Awaited<ReturnType<typeof getT>>; locale: string }) {
  if (!urls.length) return <span className="text-muted">{empty}</span>;
  return (
    <>
      <ul className="space-y-1">
        {urls.slice(0, LIST_MAX).map((u) => (
          <li key={u} className="min-w-0">
            <a href={u} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-primary">
              <UrlText url={u} origin={origin} />
            </a>
          </li>
        ))}
      </ul>
      {urls.length > LIST_MAX ? <p className="mt-1 text-xs text-muted">{t("audit.page.showing", { n: LIST_MAX.toLocaleString(locale) })}</p> : null}
    </>
  );
}

export default async function AuditPageDetail({ params, searchParams }: Props) {
  const { id, pageId } = await params;
  const query = await searchParams;
  const [ctx, t, locale] = await Promise.all([loadAuditContext(id, query.audit), getT(), getLocale()]);
  const { project, selected } = ctx;
  if (!selected) notFound();
  const detail = /^\d{1,10}$/.test(pageId) ? await getAuditPageDetail(selected.id, Number(pageId)) : null;
  if (!detail) notFound();
  const lc = locale.code;
  const base = auditBase(project.id);
  const p = detail.page;
  const origin = selected.startUrl ? new URL(selected.startUrl).origin : undefined;
  const dash = <span className="text-muted">—</span>;
  const text = (v: string | null | undefined, withLength = false): ReactNode =>
    v ? (
      <span className="block">
        <span dir="auto" className="break-words">
          {v}
        </span>
        {withLength ? <span dir="auto" className="mt-0.5 block text-xs text-muted">{t("audit.page.chars", { n: [...v].length.toLocaleString(lc) })}</span> : null}
      </span>
    ) : (
      dash
    );
  const yesNo = (v: boolean) => (v ? <Badge tone="success">{t("audit.site.yes")}</Badge> : <Badge>{t("audit.site.no")}</Badge>);
  const kb = (bytes: number) => `${(bytes / 1024).toLocaleString(lc, { maximumFractionDigits: 1 })} KB`;
  const parsed = p.isHtml && p.statusCode === 200;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TextLink href={`${base}/pages${ctx.query}`} className="inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t("audit.page.back")}
        </TextLink>
        <span className="text-xs text-muted">{t("audit.page.fetched", { date: formatDateTime(detail.fetchedAt, lc) })}</span>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start gap-3">
          <HttpStatus status={p.statusCode} t={t} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">
              <UrlText url={p.url} />
            </h2>
            {p.title ? (
              <p dir="auto" className="mt-1 text-sm text-muted">
                {p.title}
              </p>
            ) : null}
          </div>
          <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            {t("audit.page.open")}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
        {p.error ? (
          <Alert tone="error" className="mt-4">
            {t("audit.page.error")}: {p.error}
          </Alert>
        ) : null}
      </div>

      <Panel title={t("audit.page.issues")} padded={false}>
        {detail.issues.length ? (
          <ul className="divide-y divide-line">
            {detail.issues.map((i) => (
              <li key={i.code} className="space-y-1.5 px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={i.severity} t={t} />
                  <TextLink href={`${base}/issues?code=${i.code}${ctx.query ? `&${ctx.query.slice(1)}` : ""}#${i.code}`} className="text-sm text-ink">
                    {issueTitle(t, i.code)}
                  </TextLink>
                </div>
                <IssueDetails details={i.details} t={t} locale={lc} />
                <p className="text-xs text-muted">{issueText(t, i.code, "fix")}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted">{t("audit.page.noIssues")}</p>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("audit.page.response")}>
          <dl className="-my-2.5 divide-y divide-line">
            <Fact label={t("audit.pages.status")}>
              <HttpStatus status={p.statusCode} t={t} />
            </Fact>
            {p.redirects.length ? (
              <Fact label={t("audit.page.redirects")}>
                <ol className="space-y-1">
                  {p.redirects.map((h, i) => (
                    <li key={`${h.url}-${i}`} className="flex min-w-0 items-start gap-2">
                      <Badge tone="warning" className="tabular-nums">
                        {h.status}
                      </Badge>
                      <UrlText url={h.url} origin={origin} />
                    </li>
                  ))}
                  <li className="flex min-w-0 items-start gap-2">
                    <HttpStatus status={p.finalStatus} t={t} />
                    <UrlText url={p.finalUrl} origin={origin} />
                  </li>
                </ol>
              </Fact>
            ) : null}
            <Fact label={t("audit.page.contentType")}>{p.contentType ? <bdi dir="ltr">{p.contentType}</bdi> : dash}</Fact>
            <Fact label={t("audit.page.size")}>{p.sizeBytes ? <bdi>{kb(p.sizeBytes)}</bdi> : dash}</Fact>
            <Fact label={t("audit.page.ttfb")}>
              <bdi>{t("audit.pages.ms", { n: p.ttfbMs.toLocaleString(lc) })}</bdi>
            </Fact>
            <Fact label={t("audit.page.loadTime")}>
              <bdi>{t("audit.pages.ms", { n: p.loadMs.toLocaleString(lc) })}</bdi>
            </Fact>
            <Fact label={t("audit.page.encoding")}>{p.encoding ? <bdi dir="ltr">{p.encoding}</bdi> : t("audit.page.none")}</Fact>
            <Fact label={t("audit.page.depth")}>
              <bdi>{p.depth.toLocaleString(lc)}</bdi>
            </Fact>
            <Fact label={t("audit.page.inlinks")}>
              <bdi>{p.inlinks.toLocaleString(lc)}</bdi>
            </Fact>
            <Fact label={t("audit.page.inSitemap")}>{yesNo(p.inSitemap)}</Fact>
          </dl>
        </Panel>

        <Panel title={t("audit.page.meta")}>
          {parsed ? (
            <dl className="-my-2.5 divide-y divide-line">
              <Fact label={t("audit.page.title")}>{text(p.title, true)}</Fact>
              <Fact label={t("audit.page.description")}>{text(p.metaDescription, true)}</Fact>
              <Fact label={t("audit.page.canonical")}>{p.canonical ? <UrlText url={p.canonical} origin={origin} /> : dash}</Fact>
              <Fact label={t("audit.page.robots")}>{p.robotsMeta ? <bdi dir="ltr">{p.robotsMeta}</bdi> : dash}</Fact>
              <Fact label={t("audit.page.xRobots")}>{p.xRobotsTag ? <bdi dir="ltr">{p.xRobotsTag}</bdi> : dash}</Fact>
              <Fact label={t("audit.page.lang")}>{p.lang ? <bdi dir="ltr">{p.lang}</bdi> : dash}</Fact>
              <Fact label={t("audit.page.viewport")}>{yesNo(p.viewport)}</Fact>
              <Fact label={t("audit.page.charset")}>{p.charset ? <bdi dir="ltr">{p.charset}</bdi> : dash}</Fact>
            </dl>
          ) : (
            <p className="text-sm text-muted">{t("audit.page.notHtml")}</p>
          )}
        </Panel>
      </div>

      {parsed ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t("audit.page.content")}>
            <dl className="-my-2.5 divide-y divide-line">
              <Fact label={t("audit.page.words")}>
                <bdi>{p.wordCount.toLocaleString(lc)}</bdi>
              </Fact>
              <Fact label={t("audit.page.headings")}>
                <span className="flex flex-wrap gap-1.5">
                  {p.headings.map((n, i) => (
                    <Badge key={i} tone={i === 0 && n !== 1 ? "warning" : "neutral"} className="tabular-nums">
                      H{i + 1}: {n}
                    </Badge>
                  ))}
                </span>
              </Fact>
              <Fact label={t("audit.page.h1")}>{p.h1.length ? <ul className="space-y-1">{p.h1.map((h, i) => <li key={i} dir="auto">{h || "—"}</li>)}</ul> : dash}</Fact>
              <Fact label={t("audit.page.images")}>
                <span className="block">
                  <bdi>{p.imagesTotal.toLocaleString(lc)}</bdi>
                  <span className="mt-0.5 block text-xs text-muted">
                    {t("audit.page.noAlt")}: <bdi>{p.imagesWithoutAlt.toLocaleString(lc)}</bdi> · {t("audit.page.noSize")}: <bdi>{p.imagesWithoutSize.toLocaleString(lc)}</bdi>
                  </span>
                </span>
              </Fact>
              <Fact label={t("audit.page.scripts")}>
                <bdi>{p.scripts.toLocaleString(lc)}</bdi>
              </Fact>
              <Fact label={t("audit.page.styles")}>
                <bdi>{p.styles.toLocaleString(lc)}</bdi>
              </Fact>
            </dl>
          </Panel>

          <Panel title={t("audit.page.social")}>
            <dl className="-my-2.5 divide-y divide-line">
              {Object.keys(p.openGraph).length || Object.keys(p.twitterCard).length ? (
                [...Object.entries(p.openGraph), ...Object.entries(p.twitterCard)].slice(0, 20).map(([k, v]) => (
                  <Fact key={k} label={k}>
                    {/^https?:\/\//.test(v) ? <UrlText url={v} /> : text(v)}
                  </Fact>
                ))
              ) : (
                <p className="py-2.5 text-sm text-muted">—</p>
              )}
            </dl>
          </Panel>

          <Panel title={t("audit.page.structured")}>
            {p.jsonLd.length ? (
              <ul className="space-y-2">
                {p.jsonLd.map((j, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    {j.valid ? <Badge tone="success">{t("audit.page.valid")}</Badge> : <Badge tone="danger">{t("audit.page.invalid")}</Badge>}
                    {j.types.length ? j.types.map((type) => <Badge key={type}>{type}</Badge>) : j.valid ? <span className="text-xs text-muted">{t("audit.page.noTypes")}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </Panel>

          <Panel title={t("audit.page.hreflang")}>
            {p.hreflang.length ? (
              <ul className="space-y-1 text-sm">
                {p.hreflang.map((h, i) => (
                  <li key={i} className="flex min-w-0 items-start gap-2">
                    <Badge className="font-mono">{h.lang || "?"}</Badge>
                    {h.href ? <UrlText url={h.href} origin={origin} /> : dash}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </Panel>

          <Panel title={`${t("audit.page.internal")} (${p.internalLinks.length.toLocaleString(lc)})`} description={p.nofollowLinks ? `${t("audit.page.nofollow")}: ${p.nofollowLinks.toLocaleString(lc)}` : undefined}>
            <div className="text-sm">
              <UrlList urls={p.internalLinks} origin={origin} empty="—" t={t} locale={lc} />
            </div>
          </Panel>

          <Panel title={`${t("audit.page.external")} (${p.externalLinks.length.toLocaleString(lc)})`}>
            <div className="text-sm">
              <UrlList urls={p.externalLinks} origin={origin} empty="—" t={t} locale={lc} />
            </div>
          </Panel>

          {p.mixedContent.length ? (
            <Panel title={t("audit.page.mixed")}>
              <div className="text-sm">
                <UrlList urls={p.mixedContent} origin={origin} empty="—" t={t} locale={lc} />
              </div>
            </Panel>
          ) : null}

          {p.images.length ? (
            <Panel title={t("audit.page.images")} padded={false}>
              <ul className="divide-y divide-line text-sm">
                {p.images.slice(0, 20).map((img, i) => (
                  <li key={i} className="flex flex-col gap-0.5 px-5 py-2.5">
                    <UrlText url={img.src} origin={origin} className="text-xs" />
                    <span className="text-xs text-muted">
                      {t("audit.page.alt")}:{" "}
                      {img.alt === null ? <Badge tone="warning">—</Badge> : img.alt ? <bdi dir="auto" className="text-ink">{img.alt}</bdi> : <Badge>&quot;&quot;</Badge>}
                      {img.width && img.height ? <bdi className="ms-2">{`${img.width}×${img.height}`}</bdi> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      ) : null}

      <Panel title={t("audit.page.linkedFrom")} padded={false}>
        {detail.linkedFrom.length ? (
          <ul className="divide-y divide-line">
            {detail.linkedFrom.map((l) => (
              <li key={l.id} className="px-5 py-2.5 text-sm">
                <TextLink href={`${base}/pages/${l.id}${ctx.query}`} className="font-normal text-ink hover:text-primary">
                  <UrlText url={l.url} origin={origin} />
                </TextLink>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted">—</p>
        )}
      </Panel>
    </div>
  );
}
