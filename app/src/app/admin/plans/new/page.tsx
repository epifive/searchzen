import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { getSettings } from "@/lib/settings";
import { PlanForm } from "../plan-form";

export const metadata = { title: "Add plan" };

export default async function NewPlanPage() {
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="Add plan"
        description={
          <Link href="/admin/plans" className="text-primary hover:underline">
            Back to plans
          </Link>
        }
      />
      <PlanForm
        currency={settings.currency}
        plan={{
          id: null,
          name: "",
          description: "",
          priceMonthly: "0.00",
          priceYearly: "0.00",
          features: "",
          maxProjects: 5,
          maxKeywords: 300,
          checkFrequency: "daily",
          maxAuditPages: 1000,
          maxAuditsMonthly: 20,
          allowGsc: true,
          allowWhiteLabel: false,
          allowApi: true,
          removeBranding: false,
          isFree: false,
          isActive: true,
          isFeatured: false,
          sortOrder: 10,
        }}
      />
    </>
  );
}
