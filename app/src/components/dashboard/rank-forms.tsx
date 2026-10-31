"use client";

import { useRef } from "react";
import { Pause, Play, RefreshCw, Tag, Trash } from "lucide-react";
import { addKeywordsAction, bulkKeywordsAction, updateKeywordAction } from "@/app/actions/dashboard/keywords";
import { BulkForm, useRefreshingAction } from "@/components/dashboard/client-kit";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
}

/** Add keywords: one per line and / or a CSV file, with country, language, device, location, tags and target URL. */
export function AddKeywordsForm({
  projectId,
  domain,
  countries,
  languages,
  defaults,
  disabled = false,
  deviceNote,
  locationNote,
}: {
  projectId: number;
  domain: string;
  countries: Option[];
  languages: Option[];
  defaults: { country: string; language: string; device: string; location: string };
  disabled?: boolean;
  /** Shown under the device field when the active SERP provider ignores the device. */
  deviceNote?: string;
  /** Shown under the location field when the active SERP provider ignores locations. */
  locationNote?: string;
}) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useRefreshingAction(async (prev, fd) => {
    const result = await addKeywordsAction(prev, fd);
    if (result.success) formRef.current?.reset();
    return result;
  });
  return (
    <form ref={formRef} action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="project_id" value={projectId} />
      <Field label={t("rank.add.keywords")} htmlFor="kw-list" hint={t("rank.add.keywordsHint")}>
        <Textarea id="kw-list" name="keywords" rows={5} dir="auto" placeholder={t("rank.add.placeholder")} disabled={disabled} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("dash.projects.country")} htmlFor="kw-country">
          <Select id="kw-country" name="country" defaultValue={defaults.country} disabled={disabled}>
            {countries.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.projects.language")} htmlFor="kw-language">
          <Select id="kw-language" name="language" defaultValue={defaults.language} disabled={disabled}>
            {languages.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.projects.device")} htmlFor="kw-device" hint={deviceNote}>
          <Select id="kw-device" name="device" defaultValue={defaults.device} disabled={disabled}>
            <option value="desktop">{t("dash.device.desktop")}</option>
            <option value="mobile">{t("dash.device.mobile")}</option>
          </Select>
        </Field>
        <Field label={t("rank.add.location")} htmlFor="kw-location" hint={locationNote ?? t("rank.add.locationHint")}>
          <Input id="kw-location" name="location" maxLength={120} dir="auto" defaultValue={defaults.location} placeholder={t("rank.add.locationPlaceholder")} disabled={disabled} />
        </Field>
        <Field label={t("rank.add.tags")} htmlFor="kw-tags" hint={t("rank.add.tagsHint")}>
          <Input id="kw-tags" name="tags" maxLength={300} dir="auto" placeholder={t("rank.add.tagsPlaceholder")} disabled={disabled} />
        </Field>
        <Field label={t("rank.add.target")} htmlFor="kw-target" hint={t("rank.add.targetHint", { domain })}>
          <Input id="kw-target" name="target_url" maxLength={1000} dir="ltr" inputMode="url" placeholder="/pricing" disabled={disabled} />
        </Field>
      </div>
      <Field label={t("rank.add.csv")} htmlFor="kw-csv" hint={t("rank.add.csvHint")}>
        <input
          id="kw-csv"
          name="csv"
          type="file"
          accept=".csv,text/csv,text/plain"
          disabled={disabled}
          className="block w-full max-w-full text-sm text-muted file:me-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-primary-line"
        />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pendingText={t("rank.add.adding")} className={cn(disabled && "pointer-events-none opacity-50")}>
          {t("rank.add.submit")}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Bulk actions for keywords selected with the row checkboxes (form="kw-bulk"): check now,
 * pause, resume, set tags, delete.
 */
export function KeywordBulkBar({ formId, projectId, canCheck }: { formId: string; projectId: number; canCheck: boolean }) {
  const t = useT();
  const btn = buttonClass("outline", "sm");
  return (
    <BulkForm id={formId} action={bulkKeywordsAction} fields={{ project_id: projectId }} className="gap-2">
      <span className="text-xs text-muted">{t("rank.bulk.label")}</span>
      {canCheck ? (
        <button type="submit" name="op" value="check" className={btn}>
          <RefreshCw aria-hidden />
          {t("rank.bulk.check")}
        </button>
      ) : null}
      <button type="submit" name="op" value="pause" className={btn}>
        <Pause aria-hidden />
        {t("rank.bulk.pause")}
      </button>
      <button type="submit" name="op" value="resume" className={btn}>
        <Play aria-hidden />
        {t("rank.bulk.resume")}
      </button>
      <span className="inline-flex items-center gap-1">
        <label htmlFor={`${formId}-tags`} className="sr-only">
          {t("rank.add.tags")}
        </label>
        <Input id={`${formId}-tags`} name="tags" maxLength={300} dir="auto" placeholder={t("rank.bulk.tagsPlaceholder")} className="h-8 w-40" />
        <button type="submit" name="op" value="tags" className={btn}>
          <Tag aria-hidden />
          {t("rank.bulk.setTags")}
        </button>
      </span>
      <button
        type="submit"
        name="op"
        value="delete"
        className={buttonClass("ghost", "sm", "text-red-600 hover:text-red-700 dark:text-red-400")}
        onClick={(e) => {
          if (!window.confirm(t("rank.bulk.deleteConfirm"))) e.preventDefault();
        }}
      >
        <Trash aria-hidden />
        {t("rank.bulk.delete")}
      </button>
    </BulkForm>
  );
}

/** Keyword detail: tags and target URL. */
export function KeywordEditForm({ projectId, keywordId, tags, targetUrl, domain }: { projectId: number; keywordId: number; tags: string[]; targetUrl: string | null; domain: string }) {
  const t = useT();
  const [state, action] = useRefreshingAction(updateKeywordAction);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="keyword_id" value={keywordId} />
      <Field label={t("rank.add.tags")} htmlFor="kw-edit-tags" hint={t("rank.add.tagsHint")}>
        <Input id="kw-edit-tags" name="tags" maxLength={300} dir="auto" defaultValue={tags.join(", ")} />
      </Field>
      <Field label={t("rank.add.target")} htmlFor="kw-edit-target" hint={t("rank.add.targetHint", { domain })}>
        <Input id="kw-edit-target" name="target_url" maxLength={1000} dir="ltr" defaultValue={targetUrl ?? ""} placeholder="/pricing" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton size="sm" pendingText={t("dash.channels.saving")}>
          {t("dash.channels.save")}
        </SubmitButton>
      </div>
    </form>
  );
}
