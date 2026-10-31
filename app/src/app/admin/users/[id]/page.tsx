import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, Table, Td, Th } from "@/components/admin/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { countKeywordsByProject } from "@/lib/keywords";
import { GATEWAY_LABELS } from "@/lib/payments";
import { getAllPlans, getEntitlements } from "@/lib/plans";
import { getProjectSummaries } from "@/lib/projects";
import { getUsage } from "@/lib/usage";
import { formatDate, formatMoney } from "@/lib/utils";
import { UserForm } from "../user-form";

export const metadata = { title: "Edit user" };

export default async function EditUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const user = await db.selectFrom("users").selectAll().where("id", "=", Number(id)).executeTakeFirst();
  if (!user) notFound();
  const [me, plans, payments, projects, keywordCounts, usage, entitlements] = await Promise.all([
    getCurrentUser(),
    getAllPlans(),
    db.selectFrom("payments").selectAll().where("user_id", "=", user.id).orderBy("id", "desc").limit(20).execute(),
    db.selectFrom("projects").select(["id", "name", "domain", "status"]).where("user_id", "=", user.id).orderBy("id").limit(100).execute(),
    countKeywordsByProject(user.id),
    getUsage(user.id),
    getEntitlements(user),
  ]);
  const summaries = await getProjectSummaries(projects.map((p) => p.id));
  const keywordsUsed = [...keywordCounts.values()].reduce((a, b) => a + b, 0);
  const limit = (n: number) => (n ? `/ ${n.toLocaleString("en-US")}` : "· unlimited");

  return (
    <>
      <PageHeader
        title={user.name}
        description={
          <>
            Joined {formatDate(user.created_at)}.{" "}
            <Link href="/admin/users" className="text-primary hover:underline">
              Back to users
            </Link>
          </>
        }
      />
      {created ? <Alert tone="success" className="mb-4">User created.</Alert> : null}
      <UserForm
        isSelf={me?.id === user.id}
        plans={plans.filter((p) => !p.is_free).map((p) => ({ id: p.id, name: p.name }))}
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          planId: user.plan_id ?? 0,
          planExpires: user.plan_expires_at ? user.plan_expires_at.slice(0, 10) : "",
        }}
      />
      <Card title="Projects and usage" className="mt-6 max-w-3xl">
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Projects</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {projects.length.toLocaleString("en-US")} <span className="text-sm font-normal text-muted">{limit(entitlements.maxProjects)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted">Tracked keywords</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {keywordsUsed.toLocaleString("en-US")} <span className="text-sm font-normal text-muted">{limit(entitlements.maxKeywords)}</span>
            </dd>
            {entitlements.maxKeywords > 0 && keywordsUsed >= entitlements.maxKeywords * 0.8 ? (
              <Badge tone={keywordsUsed >= entitlements.maxKeywords ? "danger" : "warning"} className="mt-1">
                {Math.floor((keywordsUsed / entitlements.maxKeywords) * 100)}% used
              </Badge>
            ) : null}
          </div>
          <div>
            <dt className="text-muted">Site audits this month</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {usage.audits.toLocaleString("en-US")} <span className="text-sm font-normal text-muted">{limit(entitlements.maxAuditsMonthly)}</span>
            </dd>
            <dd className="text-xs text-muted">
              {usage.serpRequests.toLocaleString("en-US")} rank checks, {usage.auditPages.toLocaleString("en-US")} pages crawled
            </dd>
          </div>
          <div>
            <dt className="text-muted">Plan</dt>
            <dd className="mt-1 text-lg font-semibold">{user.role === "admin" ? "Administrator" : (entitlements.plan?.name ?? "Free")}</dd>
            <dd className="text-xs text-muted">
              {entitlements.checkFrequency === "daily" ? "Daily" : "Weekly"} checks · API: {entitlements.allowApi ? "yes" : "no"} · Search Console: {entitlements.allowGsc ? "yes" : "no"}
            </dd>
          </div>
        </dl>
        {projects.length ? (
          <div className="-mx-5 mt-5 -mb-5 border-t border-line">
            <Table minWidth={560}>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th className="text-right">Keywords</Th>
                  <Th className="text-right">Top 10</Th>
                  <Th className="text-right">Health score</Th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const s = summaries.get(p.id);
                  return (
                    <tr key={p.id}>
                      <Td>
                        <span className="font-medium">{p.name}</span>
                        <span className="block text-xs text-muted">
                          {p.domain}
                          {p.status === "paused" ? " · paused" : ""}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums">{(keywordCounts.get(p.id) ?? 0).toLocaleString("en-US")}</Td>
                      <Td className="text-right tabular-nums">{(s?.top10 ?? 0).toLocaleString("en-US")}</Td>
                      <Td className="text-right tabular-nums">{s?.lastAudit?.score ?? "—"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">No projects yet.</p>
        )}
      </Card>
      <Card title="Payments" padded={false} className="mt-6 max-w-3xl">
        {payments.length ? (
          <Table minWidth={520}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Method</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <Td>{formatDate(p.created_at)}</Td>
                  <Td>{GATEWAY_LABELS[p.provider]}</Td>
                  <Td className="tabular-nums">{formatMoney(p.amount, p.currency)}</Td>
                  <Td>
                    <Badge tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "danger"} className="capitalize">
                      {p.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="p-5 text-sm text-muted">No payments.</p>
        )}
      </Card>
    </>
  );
}
