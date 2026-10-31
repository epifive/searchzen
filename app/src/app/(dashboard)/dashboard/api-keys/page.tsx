import type { Metadata } from "next";
import { Crown, KeyRound, Trash2 } from "lucide-react";
import { deleteApiKeyAction } from "@/app/actions/dashboard/apikeys";
import { ActionButton } from "@/components/dashboard/actions";
import { CreateApiKeyForm } from "@/components/dashboard/api-key-forms";
import { CopyButton } from "@/components/dashboard/copy";
import { CodeBlock, DashHeader, DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { getUserApiKeys } from "@/lib/api-keys";
import { formatDateTime, formatRelative } from "@/lib/dash-format";
import { requireDashboardUser } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { getEntitlements } from "@/lib/plans";
import { baseUrl } from "@/lib/request";
import { getUserProjects } from "@/lib/projects";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.api.title") };
}

export default async function ApiKeysPage() {
  const user = await requireDashboardUser();
  const [t, locale, entitlements, keys, origin, projects] = await Promise.all([getT(), getLocale(), getEntitlements(user), getUserApiKeys(user.id), baseUrl(), getUserProjects(user.id)]);
  const projectId = projects[0]?.id ?? 1;
  const auth = `-H "Authorization: Bearer YOUR_API_KEY"`;
  const cmd = (...lines: string[]) => lines.join(" \\\n  ");
  const examples: Array<[string, string]> = [
    ["GET", cmd(`curl "${origin}/api/v1/keywords?project_id=${projectId}&sort=position&limit=100"`, auth)],
    [
      "POST",
      cmd(
        `curl -X POST "${origin}/api/v1/keywords"`,
        auth,
        `-H "Content-Type: application/json"`,
        `-d '{"project_id": ${projectId}, "keywords": ["seo audit tool", {"phrase": "rank tracker", "device": "mobile", "tags": ["brand"]}], "country": "US"}'`,
      ),
    ],
    ["POST", cmd(`curl -X POST "${origin}/api/v1/audits"`, auth, `-H "Content-Type: application/json"`, `-d '{"project_id": ${projectId}}'`)],
    ["GET", cmd(`curl "${origin}/api/v1/audits/AUDIT_ID/issues?severity=critical"`, auth)],
  ];
  const endpoints: Array<[string, string]> = [
    ["GET /api/v1/projects", t("dash.api.epProjects")],
    ["GET /api/v1/projects/{id}", t("dash.api.epProject")],
    ["GET /api/v1/keywords?project_id=", t("dash.api.epKeywords")],
    ["POST /api/v1/keywords", t("dash.api.epAddKeywords")],
    ["GET /api/v1/keywords/{id}/history?days=", t("dash.api.epHistory")],
    ["POST /api/v1/keywords/check", t("dash.api.epCheck")],
    ["POST /api/v1/audits", t("dash.api.epAudits")],
    ["GET /api/v1/audits/{id}", t("dash.api.epAudit")],
    ["GET /api/v1/audits/{id}/issues", t("dash.api.epIssues")],
  ];

  return (
    <div className="space-y-6">
      <DashHeader title={t("dash.api.title")} description={t("dash.api.subtitle")} />

      {!entitlements.allowApi ? (
        <Alert tone="warning" title={t("dash.api.upgradeTitle")}>
          <p>{t("dash.api.upgrade")}</p>
          <ButtonLink href="/pricing" size="sm" className="mt-3">
            <Crown aria-hidden />
            {t("dash.banner.cta")}
          </ButtonLink>
        </Alert>
      ) : (
        <Panel title={t("dash.api.createTitle")} description={t("dash.api.createText")}>
          <CreateApiKeyForm disabled={false} />
        </Panel>
      )}

      <Panel title={t("dash.api.list")} padded={false}>
        {keys.length ? (
          <DTable minWidth={620} label={t("dash.api.list")}>
            <thead>
              <tr>
                <DTh>{t("dash.api.name")}</DTh>
                <DTh>{t("dash.api.key")}</DTh>
                <DTh>{t("dash.api.createdAt")}</DTh>
                <DTh>{t("dash.api.lastUsed")}</DTh>
                <DTh className="text-end">
                  <span className="sr-only">{t("dash.api.actions")}</span>
                </DTh>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <DTd>
                    <span dir="auto" className="font-medium">
                      {k.name}
                    </span>
                  </DTd>
                  <DTd>
                    <code dir="ltr" className="font-mono text-[13px] text-muted">
                      {k.prefix}…
                    </code>
                  </DTd>
                  <DTd className="text-muted">{formatDateTime(k.createdAt, locale.code, false)}</DTd>
                  <DTd className="text-muted">{k.lastUsedAt ? formatRelative(k.lastUsedAt, locale.code) : t("dash.api.never")}</DTd>
                  <DTd className="text-end">
                    <ActionButton
                      action={deleteApiKeyAction}
                      fields={{ key_id: k.id }}
                      variant="ghost"
                      confirmText={t("dash.api.revokeConfirm", { name: k.name })}
                      className="items-end"
                    >
                      <Trash2 aria-hidden />
                      {t("dash.api.revoke")}
                    </ActionButton>
                  </DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
        ) : (
          <Empty icon={<KeyRound />} title={t("dash.api.emptyTitle")}>
            {t("dash.api.emptyText")}
          </Empty>
        )}
      </Panel>

      <Panel title={t("dash.api.docsTitle")} description={t("dash.api.docsText")}>
        <ul className="mb-5 space-y-2 text-sm">
          {endpoints.map(([ep, text]) => (
            <li key={ep} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
              <code dir="ltr" className="shrink-0 rounded bg-paper px-1.5 py-0.5 font-mono text-[12px]">
                {ep}
              </code>
              <span className="text-muted">{text}</span>
            </li>
          ))}
        </ul>
        <p className="mb-2 text-sm font-medium">{t("dash.api.examples")}</p>
        <div className="space-y-3">
          {examples.map(([method, code], i) => (
            <div key={i} className="relative">
              <CodeBlock className="pe-24">{code}</CodeBlock>
              <CopyButton text={code} className="absolute end-2 top-2" />
              <span className="sr-only">{method}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t("dash.api.params")}</p>
        <p className="mt-1 text-xs text-muted">{t("dash.api.errors")}</p>
      </Panel>
    </div>
  );
}
