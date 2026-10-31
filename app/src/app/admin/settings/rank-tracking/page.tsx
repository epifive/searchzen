import Link from "next/link";
import { Card, PageHeader } from "@/components/admin/ui";
import { isDemoMode } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getActiveProvider, getProviderUsage, getRankPause, PROVIDERS, providerName, REAL_PROVIDER_IDS, simulatedAvailable } from "@/lib/serp";
import { cn } from "@/lib/utils";
import { SETTING_SECTIONS } from "../sections";
import { RankSettingsForm, ResumeChecksForm, TestProviderForm } from "./rank-forms";

export const metadata = { title: "Rank tracking settings" };

const fmt = (n: number) => n.toLocaleString("en-US");

/** Admin → Settings → Rank tracking: SERP provider, keys, depth, per-run limits, test, status and usage. */
export default async function RankTrackingSettingsPage() {
  const demo = isDemoMode();
  const [active, pause, usage, queue] = await Promise.all([getActiveProvider(), getRankPause(), getProviderUsage(30), queueStats()]);
  const config = active.config;
  const providers = PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    keyLabel: p.keyLabel,
    keyPlaceholder: p.keyPlaceholder,
    website: p.website,
    note: p.note,
    keySet: p.id === "simulated" ? true : Boolean(config.keys[p.id]),
    keyFromEnv: p.id === "simulated" ? false : config.envKeys[p.id],
  }));
  const testable = providers.filter((p) => (p.id === "simulated" ? simulatedAvailable(config) : !demo)).map((p) => ({ id: p.id, name: p.name }));

  // Usage: totals per provider and a day × provider table.
  const usedProviders = [...new Set(usage.map((u) => u.provider))].sort();
  const totals = usedProviders.map((p) => {
    const rows = usage.filter((u) => u.provider === p);
    return { provider: p, requests: rows.reduce((a, r) => a + r.requests, 0), errors: rows.reduce((a, r) => a + r.errors, 0), credits: rows.reduce((a, r) => a + r.credits, 0) };
  });
  const days = [...new Set(usage.map((u) => u.day))].sort().reverse();
  const cell = (day: string, provider: string) => usage.find((u) => u.day === day && u.provider === provider);
  const credits = (provider: string, n: number) => (provider === "dataforseo" ? `$${(n / 10_000).toFixed(2)}` : fmt(n));

  return (
    <>
      <PageHeader title="Settings" description="Configure your site. Changes apply immediately." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {SETTING_SECTIONS.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/admin/settings/${s.slug}`}
                  aria-current={s.slug === "rank-tracking" ? "page" : undefined}
                  className={cn(
                    "block rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap",
                    s.slug === "rank-tracking" ? "bg-surface text-primary ring-1 ring-line" : "text-muted hover:text-ink",
                  )}
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          <Card title="Status">
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted">Provider in use</dt>
                <dd className="mt-1 font-medium">
                  {active.provider ? providerName(active.provider.id) : "None"}
                  {!active.provider && active.problem === "no_key" ? <span className="block text-xs font-normal text-amber-700 dark:text-amber-400">The chosen provider has no API key.</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Depth</dt>
                <dd className="mt-1 font-medium">Top {config.depth}</dd>
              </div>
              <div>
                <dt className="text-muted">Keywords due now</dt>
                <dd className="mt-1 font-medium tabular-nums">{fmt(queue.due)}</dd>
              </div>
              <div>
                <dt className="text-muted">Checked in the last 24 h</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {fmt(queue.checked24h)} / {fmt(queue.active)} active
                </dd>
              </div>
            </dl>
            {pause ? (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-medium">Rank checks are paused until {new Date(pause.until).toUTCString()}.</p>
                <p className="mt-1">{pause.reason}</p>
                <div className="mt-3">
                  <ResumeChecksForm />
                </div>
              </div>
            ) : null}
            {demo ? <p className="mt-4 text-xs text-muted">Demo mode: positions come from the Simulated provider when no other provider is chosen.</p> : null}
          </Card>

          <RankSettingsForm
            providers={providers}
            values={{ provider: config.provider || (demo ? "simulated" : ""), depth: config.depth, maxPerTick: config.maxPerTick, concurrency: config.concurrency, budgetSeconds: config.budgetSeconds, allowSimulated: config.allowSimulated }}
            demo={demo}
          />

          <Card title="Test connection">
            <p className="mb-4 text-sm text-muted">Runs one real check of a keyword (counted in the usage below) and shows what the provider returned.</p>
            {testable.length ? <TestProviderForm providers={testable} defaultProvider={active.provider?.id ?? config.provider} /> : <p className="text-sm text-muted">No provider can be tested.</p>}
          </Card>

          <Card title="Provider usage (last 30 days)" padded={false}>
            {totals.length ? (
              <>
                <div className="flex flex-wrap border-b border-line">
                  {totals.map((x) => (
                    <div key={x.provider} className="min-w-48 flex-1 border-e border-line px-5 py-4 last:border-e-0">
                      <p className="text-xs font-medium tracking-wide text-muted uppercase">{providerName(x.provider)}</p>
                      <p className="mt-1 font-display text-2xl font-bold tabular-nums">{fmt(x.requests)}</p>
                      <p className="text-xs text-muted">
                        requests · {fmt(x.errors)} errors{x.credits ? ` · ${x.provider === "dataforseo" ? "cost" : "credits"} ${credits(x.provider, x.credits)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-left text-sm" style={{ minWidth: 200 + usedProviders.length * 140 }}>
                    <thead>
                      <tr>
                        <th className="sticky top-0 border-b border-line bg-paper px-5 py-2.5 text-xs font-medium text-muted">Day (UTC)</th>
                        {usedProviders.map((p) => (
                          <th key={p} className="sticky top-0 border-b border-line bg-paper px-4 py-2.5 text-right text-xs font-medium text-muted">
                            {providerName(p)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((day) => (
                        <tr key={day}>
                          <td className="border-b border-line px-5 py-2 whitespace-nowrap">{day}</td>
                          {usedProviders.map((p) => {
                            const c = cell(day, p);
                            return (
                              <td key={p} className="border-b border-line px-4 py-2 text-right tabular-nums">
                                {c ? (
                                  <>
                                    {fmt(c.requests)}
                                    {c.errors ? <span className="ms-1 text-xs text-red-600 dark:text-red-400">({fmt(c.errors)} errors)</span> : null}
                                  </>
                                ) : (
                                  <span className="text-muted">–</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-muted">No provider requests in the last 30 days.</p>
            )}
          </Card>
          <p className="text-xs text-muted">
            Keys can also be set with environment variables: {REAL_PROVIDER_IDS.map((id) => (id === "dataforseo" ? "DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD" : `${id.toUpperCase()}_API_KEY`)).join(", ")}, and the provider with SERP_PROVIDER.
          </p>
        </div>
      </div>
    </>
  );
}

async function queueStats(): Promise<{ due: number; active: number; checked24h: number }> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [due, active, checked] = await Promise.all([
    db.selectFrom("keywords").select((eb) => eb.fn.countAll<number>().as("n")).where("status", "=", "active").where("next_check_at", "<=", nowIso).executeTakeFirst(),
    db.selectFrom("keywords").select((eb) => eb.fn.countAll<number>().as("n")).where("status", "=", "active").executeTakeFirst(),
    db.selectFrom("keywords").select((eb) => eb.fn.countAll<number>().as("n")).where("last_checked_at", ">=", since).executeTakeFirst(),
  ]);
  return { due: Number(due?.n ?? 0), active: Number(active?.n ?? 0), checked24h: Number(checked?.n ?? 0) };
}
