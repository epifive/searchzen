"use client";

import { useActionState } from "react";
import { createProjectAction, deleteProjectAction } from "@/app/actions/dashboard/projects";
import { initialFormState } from "@/app/actions/types";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";

export interface SelectOption {
  value: string;
  label: string;
}

/** New project: name, website and the defaults for its keywords (country, language, device). */
export function CreateProjectForm({
  countries,
  languages,
  defaults,
  disabled = false,
}: {
  countries: SelectOption[];
  languages: SelectOption[];
  defaults: { country: string; language: string };
  disabled?: boolean;
}) {
  const t = useT();
  const [state, action] = useActionState(createProjectAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dash.projects.domain")} htmlFor="project-domain" hint={t("dash.projects.domainHint")}>
          <Input id="project-domain" name="domain" required maxLength={255} dir="ltr" inputMode="url" placeholder="example.com" autoComplete="off" disabled={disabled} />
        </Field>
        <Field label={t("dash.projects.name")} htmlFor="project-name" hint={t("dash.projects.nameHint")}>
          <Input id="project-name" name="name" maxLength={120} dir="auto" placeholder={t("dash.projects.namePlaceholder")} disabled={disabled} />
        </Field>
        <Field label={t("dash.projects.country")} htmlFor="project-country">
          <Select id="project-country" name="country" defaultValue={defaults.country} disabled={disabled}>
            {countries.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.projects.language")} htmlFor="project-language">
          <Select id="project-language" name="language" defaultValue={defaults.language} disabled={disabled}>
            {languages.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.projects.device")} htmlFor="project-device" hint={t("dash.projects.defaultsHint")}>
          <Select id="project-device" name="device" defaultValue="desktop" disabled={disabled}>
            <option value="desktop">{t("dash.device.desktop")}</option>
            <option value="mobile">{t("dash.device.mobile")}</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingText={t("dash.projects.creating")}>{t("dash.projects.create")}</SubmitButton>
      </div>
    </form>
  );
}

/** Delete a project after typing its domain. */
export function DeleteProjectForm({ projectId, domain }: { projectId: number; domain: string }) {
  const t = useT();
  const [state, action] = useActionState(deleteProjectAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="project_id" value={projectId} />
      <Field label={t("dash.projects.deleteConfirmLabel", { domain })} htmlFor="delete-confirm">
        <Input id="delete-confirm" name="confirm" required dir="ltr" autoComplete="off" placeholder={domain} className="sm:max-w-xs" />
      </Field>
      <SubmitButton variant="danger" pendingText={t("dash.projects.deleting")}>
        {t("dash.projects.delete")}
      </SubmitButton>
    </form>
  );
}
