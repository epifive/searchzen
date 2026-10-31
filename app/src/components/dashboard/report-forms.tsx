"use client";

import { addScheduleAction } from "@/app/actions/dashboard/reports";
import { HiddenFields, useRefreshingAction } from "@/components/dashboard/client-kit";
import { Field, Select, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";

/** New scheduled report email: weekly or monthly, up to `max` recipients. */
export function AddScheduleForm({ projectId, max, disabled = false }: { projectId: number; max: number; disabled?: boolean }) {
  const t = useT();
  const [state, action] = useRefreshingAction(addScheduleAction);
  return (
    <form action={action} className="space-y-3">
      <HiddenFields fields={{ project_id: projectId }} />
      <FormMessage state={state} />
      <fieldset disabled={disabled} className="grid gap-3 disabled:opacity-60 sm:grid-cols-[220px_1fr]">
        <Field label={t("rep.sched.frequency")} htmlFor="sched-frequency">
          <Select id="sched-frequency" name="frequency" defaultValue="weekly">
            <option value="weekly">{t("rep.sched.weekly")}</option>
            <option value="monthly">{t("rep.sched.monthly")}</option>
          </Select>
        </Field>
        <Field label={t("rep.sched.recipients")} htmlFor="sched-recipients" hint={t("rep.sched.recipientsHint", { n: max })}>
          <Textarea id="sched-recipients" name="recipients" rows={2} required dir="ltr" placeholder="client@example.com, boss@example.com" className="min-h-20" />
        </Field>
      </fieldset>
      <div className="flex justify-end">
        <SubmitButton pendingText={t("ps.saving")}>{t("rep.sched.add")}</SubmitButton>
      </div>
    </form>
  );
}
