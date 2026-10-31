import type { Metadata } from "next";
import Link from "next/link";
import { Crown } from "lucide-react";
import { DeleteProjectForm } from "@/components/dashboard/project-forms";
import { AlertRulesEditor, SettingsSection, ShareControls, SharePasswordForm } from "@/components/dashboard/settings-forms";
import { Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { getUserChannels } from "@/lib/channels";
import { requireProject } from "@/lib/dashboard";
import { formatNumber } from "@/lib/dash-format";
import { getConnection } from "@/lib/gsc/connections";
import { getLocale, getT } from "@/lib/i18n/server";
import { getEntitlements } from "@/lib/plans";
import { baseUrl } from "@/lib/request";
import { uploadUrl } from "@/lib/site";
import { countryOptions, languageOptions } from "@/seo/format";
import { MAX_ALERT_RULES, MAX_COMPETITORS, MAX_CRAWL_DELAY_MS } from "@/seo/normalize";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return { title: `${project.name} · ${t("dash.nav.projectSettings")}` };
}

/** Project settings: one form per section, each validated with normalizeProjectSettings() on save. */
export default async function ProjectSettingsPage({ params }: Props) {
  const { id } = await params;
  const [{ user, project }, t, locale, origin] = await Promise.all([requireProject(id), getT(), getLocale(), baseUrl()]);
  const [ent, channels, connection] = await Promise.all([getEntitlements(user), getUserChannels(user.id), project.gscConnectionId ? getConnection(project.gscConnectionId) : Promise.resolve(undefined)]);
  const s = project.settings;
  const lc = locale.code;
  const shareUrl = project.shareToken ? `${origin}/r/${project.shareToken}` : null;
  const nav: Array<[string, string]> = [
    ["general", t("ps.nav.general")],
    ["defaults", t("ps.nav.defaults")],
    ["competitors", t("ps.nav.competitors")],
    ["checks", t("ps.nav.checks")],
    ["audit", t("ps.nav.audit")],
    ["alerts", t("ps.nav.alerts")],
    ["branding", t("ps.nav.branding")],
    ["sharing", t("ps.nav.sharing")],
    ["gsc", t("ps.nav.gsc")],
    ["danger", t("ps.nav.danger")],
  ];
  const upgrade = (text: string) => (
    <Alert tone="warning" className="mb-4">
      <p>{text}</p>
      <ButtonLink href="/pricing" size="sm" className="mt-2">
        <Crown aria-hidden />
        {t("dash.banner.cta")}
      </ButtonLink>
    </Alert>
  );

  return (
    <div className="space-y-6">
      <nav aria-label={t("ps.nav.label")} className="-mx-1 overflow-x-auto pb-1">
        <ul className="flex gap-1 px-1">
          {nav.map(([anchor, label]) => (
            <li key={anchor}>
              <a href={`#${anchor}`} className="block rounded-md px-2.5 py-1 text-sm whitespace-nowrap text-muted hover:bg-paper hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Panel id="general" title={t("ps.general.title")} description={t("ps.general.text")}>
        <SettingsSection projectId={project.id} section="general">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("dash.projects.name")} htmlFor="ps-name">
              <Input id="ps-name" name="name" defaultValue={project.name} required maxLength={120} dir="auto" />
            </Field>
            <Field label={t("dash.projects.domain")} htmlFor="ps-domain" hint={t("ps.general.domainHint")}>
              <Input id="ps-domain" name="domain" defaultValue={project.domain} required maxLength={255} dir="ltr" inputMode="url" />
            </Field>
          </div>
          <Switch name="status" value="active" defaultChecked={project.status === "active"} label={t("ps.general.active")} description={t("ps.general.activeHint")} />
        </SettingsSection>
      </Panel>

      <Panel id="defaults" title={t("ps.defaults.title")} description={t("ps.defaults.text")}>
        <SettingsSection projectId={project.id} section="defaults">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("dash.projects.country")} htmlFor="ps-country">
              <Select id="ps-country" name="country" defaultValue={s.country}>
                {countryOptions(lc).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("dash.projects.language")} htmlFor="ps-language">
              <Select id="ps-language" name="language" defaultValue={s.language}>
                {languageOptions(lc).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("dash.projects.device")} htmlFor="ps-device">
              <Select id="ps-device" name="device" defaultValue={s.device}>
                <option value="desktop">{t("dash.device.desktop")}</option>
                <option value="mobile">{t("dash.device.mobile")}</option>
              </Select>
            </Field>
            <Field label={t("ps.defaults.location")} htmlFor="ps-location" hint={t("ps.defaults.locationHint")}>
              <Input id="ps-location" name="location" defaultValue={s.location} maxLength={120} dir="auto" placeholder={t("ps.defaults.locationPlaceholder")} />
            </Field>
          </div>
        </SettingsSection>
      </Panel>

      <Panel id="competitors" title={t("ps.competitors.title")} description={t("ps.competitors.text", { n: MAX_COMPETITORS })}>
        <SettingsSection projectId={project.id} section="competitors">
          <Field label={t("ps.competitors.label")} htmlFor="ps-competitors" hint={t("ps.competitors.hint", { n: MAX_COMPETITORS })}>
            <Textarea id="ps-competitors" name="competitors" defaultValue={s.competitors.join("\n")} rows={5} dir="ltr" placeholder={"competitor.com\nanother-site.io"} className="font-mono text-[13px]" />
          </Field>
        </SettingsSection>
      </Panel>

      <Panel id="checks" title={t("ps.checks.title")} description={t("ps.checks.text")}>
        {ent.checkFrequency !== "daily" ? upgrade(t("ps.checks.upgrade")) : null}
        <SettingsSection projectId={project.id} section="checks">
          <fieldset className="space-y-2">
            <legend className="sr-only">{t("ps.checks.title")}</legend>
            {(["daily", "weekly"] as const).map((f) => (
              <label key={f} className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm has-[:checked]:border-primary-line has-[:checked]:bg-primary-soft">
                <input type="radio" name="checkFrequency" value={f} defaultChecked={(ent.checkFrequency === "weekly" ? "weekly" : s.checkFrequency) === f} disabled={f === "daily" && ent.checkFrequency !== "daily"} className="mt-0.5 accent-[var(--primary)]" />
                <span>
                  <span className="block font-medium">{t(`ps.checks.${f}`)}</span>
                  <span className="block text-xs text-muted">{t(`ps.checks.${f}Hint`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </SettingsSection>
      </Panel>

      <Panel id="audit" title={t("ps.audit.title")} description={t("ps.audit.text")}>
        <SettingsSection projectId={project.id} section="audit">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("ps.audit.schedule")} htmlFor="ps-schedule">
              <Select id="ps-schedule" name="auditSchedule" defaultValue={s.auditSchedule}>
                <option value="off">{t("ps.audit.scheduleOff")}</option>
                <option value="weekly">{t("ps.audit.scheduleWeekly")}</option>
                <option value="monthly">{t("ps.audit.scheduleMonthly")}</option>
              </Select>
            </Field>
            <Field
              label={t("ps.audit.pageLimit")}
              htmlFor="ps-pages"
              hint={ent.maxAuditPages > 0 ? t("ps.audit.pageLimitPlan", { n: formatNumber(ent.maxAuditPages, lc) }) : t("ps.audit.pageLimitHint")}
            >
              <Input id="ps-pages" name="auditPageLimit" type="number" min={0} max={ent.maxAuditPages || undefined} defaultValue={s.auditPageLimit} />
            </Field>
            <Field label={t("ps.audit.delay")} htmlFor="ps-delay" hint={t("ps.audit.delayHint", { n: formatNumber(MAX_CRAWL_DELAY_MS, lc) })}>
              <Input id="ps-delay" name="crawlDelayMs" type="number" min={0} max={MAX_CRAWL_DELAY_MS} step={100} defaultValue={s.crawlDelayMs} />
            </Field>
            <Field label={t("ps.audit.userAgent")} htmlFor="ps-ua" hint={t("ps.audit.userAgentHint")}>
              <Select id="ps-ua" name="userAgent" defaultValue={s.userAgent}>
                <option value="bot">{t("ps.audit.uaBot")}</option>
                <option value="browser">{t("ps.audit.uaBrowser")}</option>
              </Select>
            </Field>
            <Field label={t("ps.audit.include")} htmlFor="ps-include" hint={t("ps.audit.includeHint")}>
              <Textarea id="ps-include" name="includePatterns" defaultValue={s.includePatterns.join("\n")} rows={3} dir="ltr" placeholder="/blog/*" className="font-mono text-[13px]" />
            </Field>
            <Field label={t("ps.audit.exclude")} htmlFor="ps-exclude" hint={t("ps.audit.excludeHint")}>
              <Textarea id="ps-exclude" name="excludePatterns" defaultValue={s.excludePatterns.join("\n")} rows={3} dir="ltr" placeholder={"/cart\n/*?sort="} className="font-mono text-[13px]" />
            </Field>
          </div>
        </SettingsSection>
      </Panel>

      <Panel id="alerts" title={t("ps.alerts.title")} description={t("ps.alerts.text")}>
        <SettingsSection projectId={project.id} section="alerts">
          <div>
            <p className="mb-2 text-sm font-medium">{t("ps.alerts.rules")}</p>
            <AlertRulesEditor initial={s.alertRules} max={MAX_ALERT_RULES} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{t("ps.alerts.channels")}</p>
            {channels.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {channels.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <Checkbox name="channel" value={c.id} defaultChecked={s.alertChannelIds.includes(c.id)} label={<bdi>{c.name}</bdi>} className="min-w-0 flex-1" />
                    <Badge tone={c.isActive ? "primary" : "neutral"}>{t(`dash.channels.type.${c.type}`)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                {t("ps.alerts.noChannels")}{" "}
                <Link href="/dashboard/channels/new" className="font-medium text-primary hover:underline">
                  {t("ps.alerts.addChannel")}
                </Link>
              </p>
            )}
          </div>
          <Switch name="alertOnAudit" defaultChecked={s.alertOnAudit} label={t("ps.alerts.onAudit")} description={t("ps.alerts.onAuditHint")} />
        </SettingsSection>
      </Panel>

      <Panel id="branding" title={t("ps.branding.title")} description={t("ps.branding.text")}>
        {!ent.allowWhiteLabel ? upgrade(t("ps.branding.upgrade")) : null}
        <SettingsSection projectId={project.id} section="branding" disabled={!ent.allowWhiteLabel}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("ps.branding.company")} htmlFor="ps-company" hint={t("ps.branding.companyHint")}>
              <Input id="ps-company" name="companyName" defaultValue={s.report.companyName} maxLength={120} dir="auto" placeholder={project.name} />
            </Field>
            <Field label={t("ps.branding.color")} htmlFor="ps-color" hint={t("ps.branding.colorHint")}>
              <div className="flex gap-2">
                <Input id="ps-color" name="color" defaultValue={s.report.color} maxLength={7} dir="ltr" placeholder="#0e7490" className="font-mono" />
                <span className="size-10 shrink-0 rounded-lg border border-line" style={{ background: s.report.color || "var(--primary)" }} aria-hidden />
              </div>
            </Field>
            <Field label={t("ps.branding.logo")} htmlFor="ps-logo" hint={t("ps.branding.logoHint")}>
              <Input id="ps-logo" name="logo" defaultValue={s.report.logo} maxLength={500} dir="ltr" placeholder="https://…/logo.png" />
            </Field>
            <Field label={t("ps.branding.upload")} htmlFor="ps-logo-file" hint={t("ps.branding.uploadHint")}>
              <Input id="ps-logo-file" name="logo_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="pt-1.5" />
            </Field>
          </div>
          {s.report.logo ? (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-paper p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={uploadUrl(s.report.logo)} alt={t("ps.branding.logo")} className="h-10 max-w-48 object-contain" />
              <Checkbox name="logo_remove" label={t("ps.branding.removeLogo")} />
            </div>
          ) : null}
        </SettingsSection>
      </Panel>

      <Panel id="sharing" title={t("ps.sharing.title")} description={t("ps.sharing.text")}>
        <div className="space-y-6">
          <ShareControls projectId={project.id} url={shareUrl} />
          <div className="border-t border-line pt-5">
            <p className="mb-1 text-sm font-medium">{t("rep.password.title")}</p>
            <p className="mb-3 text-xs text-muted">{s.sharePasswordHash ? t("rep.password.on") : t("rep.password.offText")}</p>
            <SharePasswordForm projectId={project.id} hasPassword={Boolean(s.sharePasswordHash)} />
          </div>
          <p className="text-xs text-muted">
            {t("ps.sharing.badge")}{" "}
            <Link href={`/dashboard/projects/${project.id}/reports#badge`} className="font-medium text-primary hover:underline">
              {t("ps.sharing.badgeLink")}
            </Link>
          </p>
        </div>
      </Panel>

      <Panel id="gsc" title={t("ps.gsc.title")} description={t("ps.gsc.text")}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {project.gscProperty ? (
            <p>
              <bdi dir="ltr" className="font-medium">
                {project.gscProperty}
              </bdi>
              {connection ? <span className="text-muted"> · {connection.email}</span> : null}
            </p>
          ) : (
            <p className="text-muted">{t("ps.gsc.none")}</p>
          )}
          <ButtonLink href={`/dashboard/projects/${project.id}/gsc`} size="sm" variant="outline">
            {project.gscProperty ? t("ps.gsc.manage") : t("ps.gsc.connect")}
          </ButtonLink>
        </div>
      </Panel>

      <Panel id="danger" title={t("dash.projects.dangerTitle")} description={t("dash.projects.deleteText")} className="border-red-200 dark:border-red-900">
        <DeleteProjectForm projectId={project.id} domain={project.domain} />
      </Panel>
    </div>
  );
}
