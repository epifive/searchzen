"use client";

import { useActionState, useState, useTransition } from "react";
import { initialFormState } from "@/app/actions/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { deletePlan, savePlan } from "../actions/plans";

export interface EditablePlan {
  id: number | null;
  name: string;
  description: string;
  priceMonthly: string;
  priceYearly: string;
  features: string;
  maxProjects: number;
  maxKeywords: number;
  checkFrequency: "weekly" | "daily";
  maxAuditPages: number;
  maxAuditsMonthly: number;
  allowGsc: boolean;
  allowWhiteLabel: boolean;
  allowApi: boolean;
  removeBranding: boolean;
  isFree: boolean;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

export function PlanForm({ plan, currency }: { plan: EditablePlan; currency: string }) {
  const [state, action] = useActionState(savePlan, initialFormState);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState("");

  return (
    <div className="max-w-3xl space-y-6">
      <form action={action} className="space-y-6 rounded-xl border border-line bg-surface p-6">
        <FormMessage state={state} />
        <input type="hidden" name="id" value={plan.id ?? ""} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" defaultValue={plan.name} required maxLength={100} />
          </Field>
          <Field label="Sort order" htmlFor="sort_order" hint="Lower numbers appear first.">
            <Input id="sort_order" name="sort_order" type="number" min={0} max={999} defaultValue={plan.sortOrder} />
          </Field>
          <Field label="Short description" htmlFor="description" className="sm:col-span-2">
            <Input id="description" name="description" defaultValue={plan.description} maxLength={255} />
          </Field>
          <Field label={`Monthly price (${currency})`} htmlFor="price_monthly" hint="0 hides the monthly option.">
            <Input id="price_monthly" name="price_monthly" type="number" min={0} step="0.01" defaultValue={plan.priceMonthly} />
          </Field>
          <Field label={`Yearly price (${currency})`} htmlFor="price_yearly" hint="0 hides the yearly option.">
            <Input id="price_yearly" name="price_yearly" type="number" min={0} step="0.01" defaultValue={plan.priceYearly} />
          </Field>
          <Field label="Projects" htmlFor="max_projects" hint="Websites per account. 0 = unlimited.">
            <Input id="max_projects" name="max_projects" type="number" min={0} max={100000} defaultValue={plan.maxProjects} required />
          </Field>
          <Field label="Tracked keywords" htmlFor="max_keywords" hint="All projects of the account together. 0 = unlimited.">
            <Input id="max_keywords" name="max_keywords" type="number" min={0} max={10000000} defaultValue={plan.maxKeywords} required />
          </Field>
          <Field label="Rank checks" htmlFor="check_frequency" hint="How often keywords are checked at most. Each check uses up to depth ÷ 10 requests to your SERP provider (one per page of 10 results; the depth is set in Settings → Rank tracking).">
            <Select id="check_frequency" name="check_frequency" defaultValue={plan.checkFrequency}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </Select>
          </Field>
          <Field label="Pages per site audit" htmlFor="max_audit_pages" hint="Pages crawled in one audit. 0 = unlimited: audits crawl 500 pages by default unless the project sets a higher limit (at most 50,000).">
            <Input id="max_audit_pages" name="max_audit_pages" type="number" min={0} max={1000000} defaultValue={plan.maxAuditPages} required />
          </Field>
          <Field label="Site audits per month" htmlFor="max_audits_monthly" hint="Audits started per calendar month, all projects together. 0 = unlimited.">
            <Input id="max_audits_monthly" name="max_audits_monthly" type="number" min={0} max={1000000} defaultValue={plan.maxAuditsMonthly} required />
          </Field>
          <div className="space-y-4 sm:col-span-2">
            <Switch name="allow_gsc" label="Google Search Console" description="Customers can connect Search Console and see clicks, impressions and queries per project." defaultChecked={plan.allowGsc} />
            <Switch name="allow_api" label="REST API" description="Customers can create API keys to manage projects and keywords, read rankings and start audits over the REST API." defaultChecked={plan.allowApi} />
            <Switch name="allow_white_label" label="White-label reports" description="Customers can put their own logo, colour and company name on client reports and share pages." defaultChecked={plan.allowWhiteLabel} />
          </div>
          <Field label="Features" htmlFor="features" hint="One per line. Shown with a tick on the pricing page." className="sm:col-span-2">
            <Textarea id="features" name="features" defaultValue={plan.features} rows={5} />
          </Field>
        </div>
        <div className="space-y-4 border-t border-line pt-6">
          <Switch name="remove_branding" label="Remove branding" description='Hide the "Powered by" line in shared reports and report emails.' defaultChecked={plan.removeBranding} />
          <Switch name="is_featured" label="Recommended" description="Highlight this plan on the pricing page." defaultChecked={plan.isFeatured} />
          <Switch name="is_active" label="Show on pricing page" defaultChecked={plan.isActive} />
          <Switch
            name="is_free"
            label="This is the free plan"
            description="Its limits apply to visitors and free accounts. Only one plan can be the free plan."
            defaultChecked={plan.isFree}
          />
        </div>
        <div className="flex justify-end">
          <SubmitButton>{plan.id ? "Save plan" : "Create plan"}</SubmitButton>
        </div>
      </form>

      {plan.id ? (
        <section className="rounded-xl border border-red-200 bg-surface p-6 dark:border-red-900">
          <h2 className="font-sans text-sm font-semibold tracking-normal">Delete plan</h2>
          <p className="mt-1 text-sm text-muted">Plans with active users can&apos;t be deleted. Hide them instead.</p>
          {deleteError ? <Alert tone="error" className="mt-3">{deleteError}</Alert> : null}
          <Button
            variant="danger"
            size="sm"
            className="mt-4"
            disabled={deleting}
            onClick={() => {
              if (!confirm(`Delete the ${plan.name} plan?`)) return;
              startDelete(async () => {
                const result = await deletePlan(plan.id!);
                if (result?.error) setDeleteError(result.error);
              });
            }}
          >
            {deleting ? "Deleting…" : "Delete plan"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
