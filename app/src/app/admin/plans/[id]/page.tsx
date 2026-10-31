import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import { getPlan } from "@/lib/plans";
import { getSettings } from "@/lib/settings";
import { PlanForm } from "../plan-form";

export const metadata = { title: "Edit plan" };

const toMoney = (cents: number) => (cents / 100).toFixed(2);

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const plan = await getPlan(Number((await params).id));
  if (!plan) notFound();
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title={`Edit ${plan.name}`}
        description={
          <Link href="/admin/plans" className="text-primary hover:underline">
            Back to plans
          </Link>
        }
      />
      <PlanForm
        currency={settings.currency}
        plan={{
          id: plan.id,
          name: plan.name,
          description: plan.description ?? "",
          priceMonthly: toMoney(plan.price_monthly),
          priceYearly: toMoney(plan.price_yearly),
          features: plan.features ?? "",
          maxProjects: plan.max_projects,
          maxKeywords: plan.max_keywords,
          checkFrequency: plan.check_frequency === "daily" ? "daily" : "weekly",
          maxAuditPages: plan.max_audit_pages,
          maxAuditsMonthly: plan.max_audits_monthly,
          allowGsc: plan.allow_gsc === 1,
          allowWhiteLabel: plan.allow_white_label === 1,
          allowApi: plan.allow_api === 1,
          removeBranding: plan.remove_branding === 1,
          isFree: plan.is_free === 1,
          isActive: plan.is_active === 1,
          isFeatured: plan.is_featured === 1,
          sortOrder: plan.sort_order,
        }}
      />
    </>
  );
}
