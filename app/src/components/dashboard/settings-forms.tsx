"use client";

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveProjectSettingsAction, setDigestAction, setShareAction, setSharePasswordAction } from "@/app/actions/dashboard/projects";
import { HiddenFields, useRefreshingAction } from "@/components/dashboard/client-kit";
import { CopyField } from "@/components/dashboard/copy";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ALERT_TOPS, type AlertRule, type AlertRuleType } from "@/seo/types";

/** A section of the project settings page: its own form, message and save button. */
export function SettingsSection({
  projectId,
  section,
  children,
  disabled = false,
  className,
}: {
  projectId: number;
  section: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const [state, action] = useRefreshingAction(saveProjectSettingsAction);
  return (
    <form action={action} className={cn("space-y-4", className)}>
      <HiddenFields fields={{ project_id: projectId, section }} />
      <FormMessage state={state} />
      <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
        {children}
      </fieldset>
      <div className="flex justify-end">
        {disabled ? null : <SubmitButton pendingText={t("ps.saving")}>{t("ps.save")}</SubmitButton>}
      </div>
    </form>
  );
}

const RULE_TYPES: AlertRuleType[] = ["enters_top", "leaves_top", "change", "url_lost"];

function defaultRule(type: AlertRuleType): AlertRule {
  if (type === "change") return { type, min: 5 };
  if (type === "url_lost") return { type };
  return { type, top: 10 };
}

/** Editable list of rank alert rules, posted as JSON in the "rules" field. */
export function AlertRulesEditor({ initial, max }: { initial: AlertRule[]; max: number }) {
  const t = useT();
  const [rules, setRules] = useState<Array<AlertRule & { key: number }>>(() => initial.map((r, i) => ({ ...r, key: i })));
  const [nextKey, setNextKey] = useState(initial.length);
  const update = (key: number, rule: AlertRule) => setRules((list) => list.map((r) => (r.key === key ? { ...rule, key } : r)));
  return (
    <div className="space-y-2">
      <input type="hidden" name="rules" value={JSON.stringify(rules.map(({ key: _k, ...r }) => (void _k, r)))} />
      {rules.length ? null : <p className="text-sm text-muted">{t("ps.alerts.none")}</p>}
      <ul className="space-y-2">
        {rules.map((rule) => (
          <li key={rule.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper p-2">
            <Select
              aria-label={t("ps.alerts.type")}
              value={rule.type}
              onChange={(e) => update(rule.key, defaultRule(e.target.value as AlertRuleType))}
              className="h-9 w-[calc(100%-2.75rem)]! min-w-0 sm:w-auto!"
            >
              {RULE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`ps.alerts.rule.${type}`)}
                </option>
              ))}
            </Select>
            {rule.type === "enters_top" || rule.type === "leaves_top" ? (
              <Select
                aria-label={t("ps.alerts.top")}
                value={rule.top}
                onChange={(e) => update(rule.key, { type: rule.type, top: Number(e.target.value) as (typeof ALERT_TOPS)[number] })}
                className="h-9 w-auto!"
              >
                {ALERT_TOPS.map((n) => (
                  <option key={n} value={n}>
                    {t("ps.alerts.topN", { n })}
                  </option>
                ))}
              </Select>
            ) : null}
            {rule.type === "change" ? (
              <label className="inline-flex items-center gap-2 text-sm">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={rule.min}
                  onChange={(e) => update(rule.key, { type: "change", min: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                  className="h-9 w-20!"
                  aria-label={t("ps.alerts.min")}
                />
                <span className="whitespace-nowrap text-muted">{t("ps.alerts.places")}</span>
              </label>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="ms-auto"
              onClick={() => setRules((list) => list.filter((r) => r.key !== rule.key))}
              aria-label={t("ps.alerts.remove")}
              title={t("ps.alerts.remove")}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        disabled={rules.length >= max}
        onClick={() => {
          setRules((list) => [...list, { ...defaultRule("change"), key: nextKey }]);
          setNextKey((k) => k + 1);
        }}
      >
        <Plus aria-hidden />
        {t("ps.alerts.add")}
      </Button>
    </div>
  );
}

/** Share link on / off / regenerate, with the link to copy. */
export function ShareControls({ projectId, url }: { projectId: number; url: string | null }) {
  const t = useT();
  const [state, action, pending] = useRefreshingAction(setShareAction);
  const button = (mode: string, label: string, variant: "primary" | "outline" | "danger" = "outline", confirm?: string) => (
    <form
      action={action}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <HiddenFields fields={{ project_id: projectId, mode }} />
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {label}
      </Button>
    </form>
  );
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      {url ? (
        <>
          <CopyField value={url} label={t("rep.share.link")} />
          <div className="flex flex-wrap gap-2">
            <a href={url} target="_blank" rel="noopener" className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-primary-line hover:text-primary">
              {t("rep.share.open")}
            </a>
            {button("regenerate", t("rep.share.regenerate"), "outline", t("rep.share.regenerateConfirm"))}
            {button("off", t("rep.share.turnOff"), "outline", t("rep.share.offConfirm"))}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {button("on", t("rep.share.turnOn"), "primary")}
          <span className="text-sm text-muted">{t("rep.share.offText")}</span>
        </div>
      )}
    </div>
  );
}

/** Report password: set / change, or remove. */
export function SharePasswordForm({ projectId, hasPassword }: { projectId: number; hasPassword: boolean }) {
  const t = useT();
  const [state, action] = useRefreshingAction(setSharePasswordAction);
  const [removeState, removeAction, removing] = useRefreshingAction(setSharePasswordAction);
  return (
    <div className="space-y-3">
      <FormMessage state={state.error || state.success ? state : removeState} />
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <HiddenFields fields={{ project_id: projectId }} />
        <Field label={hasPassword ? t("rep.password.change") : t("rep.password.set")} htmlFor="share-password" className="min-w-0 flex-1">
          <Input id="share-password" name="password" type="password" minLength={4} maxLength={100} autoComplete="new-password" required />
        </Field>
        <SubmitButton pendingText={t("ps.saving")}>{t("rep.password.save")}</SubmitButton>
      </form>
      {hasPassword ? (
        <form action={removeAction}>
          <HiddenFields fields={{ project_id: projectId, remove: 1 }} />
          <Button type="submit" variant="ghost" size="sm" disabled={removing}>
            {t("rep.password.remove")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Weekly digest email on / off (saved as soon as it is switched). `disabledText` explains why nothing is sent right now. */
export function DigestToggle({ enabled, disabledText }: { enabled: boolean; disabledText?: string }) {
  const t = useT();
  const [state, action, pending] = useRefreshingAction(setDigestAction);
  return (
    <form action={action} className="space-y-2">
      <Switch
        name="digest"
        defaultChecked={enabled}
        disabled={pending}
        label={t("digest.toggle")}
        description={disabledText ? `${t("digest.toggleHint")} ${disabledText}` : t("digest.toggleHint")}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
      {state.error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : (
        <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
          {state.success ?? ""}
        </p>
      )}
    </form>
  );
}
