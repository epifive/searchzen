"use client";

import { assignPropertyAction } from "@/app/actions/dashboard/gsc";
import { HiddenFields, useRefreshingAction } from "@/components/dashboard/client-kit";
import { Field, Select } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";

export interface PickerGroup {
  connectionId: number;
  email: string;
  sites: Array<{ siteUrl: string; matches: boolean }>;
}

/** Choose a Search Console property (grouped by Google account) for the project. */
export function GscPropertyPicker({ projectId, groups, current }: { projectId: number; groups: PickerGroup[]; current?: string | null }) {
  const t = useT();
  const [state, action] = useRefreshingAction(assignPropertyAction);
  const first = groups.flatMap((g) => g.sites.filter((s) => s.matches).map((s) => `${g.connectionId}|${s.siteUrl}`))[0];
  const currentValue = current ? groups.flatMap((g) => g.sites.filter((s) => s.siteUrl === current).map((s) => `${g.connectionId}|${s.siteUrl}`))[0] : undefined;
  return (
    <form action={action} className="space-y-3">
      <HiddenFields fields={{ project_id: projectId }} />
      <FormMessage state={state} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label={t("gsc.picker.label")} htmlFor="gsc-property" hint={t("gsc.picker.hint")} className="min-w-0 flex-1">
          <Select id="gsc-property" name="property" defaultValue={currentValue ?? first ?? ""} required dir="ltr">
            <option value="" disabled>
              {t("gsc.picker.choose")}
            </option>
            {groups.map((g) => (
              <optgroup key={g.connectionId} label={g.email}>
                {g.sites.map((s) => (
                  <option key={s.siteUrl} value={`${g.connectionId}|${s.siteUrl}`}>
                    {s.siteUrl}
                    {s.matches ? " ✓" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <SubmitButton pendingText={t("gsc.picker.importing")}>{t("gsc.picker.use")}</SubmitButton>
      </div>
    </form>
  );
}
