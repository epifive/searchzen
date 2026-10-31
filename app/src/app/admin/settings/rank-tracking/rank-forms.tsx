"use client";

import { useActionState, useState } from "react";
import { initialFormState } from "@/app/actions/types";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { resumeRankChecks, saveRankSettings, testRankProvider, type TestState } from "../../actions/serp";

export interface ProviderView {
  id: string;
  name: string;
  keyLabel: string;
  keyPlaceholder: string;
  website: string;
  note: string;
  /** A key is saved (never the key itself). */
  keySet: boolean;
  /** The key comes from an environment variable. */
  keyFromEnv: boolean;
}

const DEPTH_NOTES: Record<number, string> = {
  10: "1 request per check (page 1 only). Cheapest; keywords beyond #10 show as \"10+\".",
  20: "Up to 2 requests per check. Recommended: covers pages 1–2.",
  50: "Up to 5 requests per check. Costs up to 5× depth 10.",
  100: "Up to 10 requests per check. Costs up to 10× depth 10; use with care.",
};

export function RankSettingsForm({
  providers,
  values,
  demo,
}: {
  providers: ProviderView[];
  values: { provider: string; depth: number; maxPerTick: number; concurrency: number; budgetSeconds: number; allowSimulated: boolean };
  demo: boolean;
}) {
  const [state, action] = useActionState(saveRankSettings, initialFormState);
  const [provider, setProvider] = useState(values.provider);
  const [depth, setDepth] = useState(values.depth);
  const [allowSim, setAllowSim] = useState(values.allowSimulated);
  const real = providers.filter((p) => p.id !== "simulated");
  const sim = providers.find((p) => p.id === "simulated");
  return (
    <form action={action} className="rounded-xl border border-line bg-surface">
      <header className="border-b border-line px-6 py-4">
        <h2 className="font-sans text-base font-semibold tracking-normal">Rank tracking</h2>
        <p className="mt-0.5 text-sm text-muted">The SERP data provider that checks Google rankings, its API keys and how much each scheduler run may do.</p>
      </header>
      <div className="space-y-8 px-6 py-6">
        <FormMessage state={state} />
        <fieldset className="space-y-3">
          <legend className="mb-4 w-full border-b border-line pb-2 text-sm font-semibold text-ink">Active provider</legend>
          {[{ id: "", name: "None", note: "Rank checks are off. Keywords are kept but not checked.", website: "", keySet: true } as Pick<ProviderView, "id" | "name" | "note" | "website" | "keySet">, ...real, ...(sim && (allowSim || demo) ? [sim] : [])].map((p) => (
            <label
              key={p.id || "none"}
              className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3", provider === p.id ? "border-primary bg-primary-soft" : "border-line hover:border-primary-line")}
            >
              <input type="radio" name="provider" value={p.id} checked={provider === p.id} onChange={() => setProvider(p.id)} className="mt-1 accent-[var(--primary)]" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {p.name}
                  {p.id && p.id !== "simulated" ? p.keySet ? <Badge tone="success">Key saved</Badge> : <Badge tone="warning">No key</Badge> : null}
                  {p.id === "simulated" ? <Badge tone="warning">Fake data</Badge> : null}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {p.note}
                  {p.website ? (
                    <>
                      {" "}
                      <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {p.website.replace(/^https:\/\/(www\.)?/, "")}
                      </a>
                    </>
                  ) : null}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="mb-4 w-full border-b border-line pb-2 text-sm font-semibold text-ink">API keys</legend>
          <p className="text-xs text-muted">Keys are stored on your server and never shown again. Leave a field empty to keep the saved key.</p>
          {real.map((p) => (
            <Field
              key={p.id}
              label={`${p.name}: ${p.keyLabel}`}
              htmlFor={`key-${p.id}`}
              hint={p.keyFromEnv ? "Set by an environment variable on the server." : p.keySet ? "A key is saved. Type a new one to replace it." : undefined}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  id={`key-${p.id}`}
                  name={`key_${p.id}`}
                  type="password"
                  autoComplete="off"
                  dir="ltr"
                  placeholder={p.keySet ? "••••••••••••" : p.keyPlaceholder}
                  disabled={p.keyFromEnv}
                  className="max-w-md min-w-0 flex-1"
                />
                {p.keySet && !p.keyFromEnv ? (
                  <label className="inline-flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" name={`clear_${p.id}`} className="size-4 accent-[var(--primary)]" />
                    Remove saved key
                  </label>
                ) : null}
              </div>
            </Field>
          ))}
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="mb-4 w-full border-b border-line pb-2 text-sm font-semibold text-ink">Checks</legend>
          <Field label="Depth (results checked per keyword)" htmlFor="rank-depth" hint={DEPTH_NOTES[depth]}>
            <Select id="rank-depth" name="depth" value={String(depth)} onChange={(e) => setDepth(Number(e.target.value))} className="max-w-xs">
              {[10, 20, 50, 100].map((d) => (
                <option key={d} value={d}>
                  Top {d}
                </option>
              ))}
            </Select>
          </Field>
          <p className="-mt-2 text-xs text-muted">
            Google shows 10 results per page and ignores requests for 100 at once (since September 2025), so every page of 10 is a separate, billed request. Checks stop early once the project&apos;s domain
            and its competitors are found.
          </p>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Checks per run" htmlFor="rank-max" hint="Keywords checked per scheduler run at most (1–500).">
              <Input id="rank-max" name="max_per_tick" type="number" min={1} max={500} defaultValue={values.maxPerTick} />
            </Field>
            <Field label="Parallel requests" htmlFor="rank-conc" hint="Checks running at the same time (1–10). Respect your plan's rate limit.">
              <Input id="rank-conc" name="concurrency" type="number" min={1} max={10} defaultValue={values.concurrency} />
            </Field>
            <Field label="Time per run (seconds)" htmlFor="rank-budget" hint="Share of each scheduler run used for rank checks (5–50). Keep it under your host's request time limit.">
              <Input id="rank-budget" name="budget" type="number" min={5} max={50} defaultValue={values.budgetSeconds} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="mb-4 w-full border-b border-line pb-2 text-sm font-semibold text-ink">Testing</legend>
          <Switch
            name="allow_simulated"
            label="Allow the Simulated provider (testing only)"
            description="Generates realistic but fake positions without an API, so you can try the dashboard, alerts and reports. Never use it for real clients."
            checked={allowSim}
            onChange={(e) => {
              setAllowSim(e.target.checked);
              if (!e.target.checked && provider === "simulated" && !demo) setProvider("");
            }}
          />
        </fieldset>
      </div>
      <footer className="flex justify-end border-t border-line px-6 py-4">
        <SubmitButton>Save changes</SubmitButton>
      </footer>
    </form>
  );
}

export function TestProviderForm({ providers, defaultProvider }: { providers: Array<{ id: string; name: string }>; defaultProvider: string }) {
  const [state, action] = useActionState<TestState, FormData>(testRankProvider, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Provider" htmlFor="test-provider">
          <Select id="test-provider" name="provider" defaultValue={defaultProvider || providers[0]?.id}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="API key (optional)" htmlFor="test-key" hint="Test a key before saving it. Empty = the saved key.">
          <Input id="test-key" name="key" type="password" autoComplete="off" dir="ltr" />
        </Field>
        <Field label="Keyword" htmlFor="test-keyword">
          <Input id="test-keyword" name="keyword" defaultValue="coffee" dir="auto" />
        </Field>
        <Field label="Domain to find" htmlFor="test-domain">
          <Input id="test-domain" name="domain" defaultValue="wikipedia.org" dir="ltr" />
        </Field>
      </div>
      <SubmitButton variant="outline" size="sm" pendingText="Checking…">
        Test connection
      </SubmitButton>
      {state.result ? (
        <div className="rounded-lg border border-line bg-paper p-4 text-sm">
          <p>
            <span className="font-medium">Position:</span> {state.result.position ?? "not found"}
            {state.result.url ? (
              <>
                {" "}
                · <span dir="ltr">{state.result.url}</span>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-muted">
            {state.result.requests} request{state.result.requests === 1 ? "" : "s"}
            {state.result.credits !== null ? ` · ${state.result.credits} credits` : ""} · features: {state.result.features.join(", ") || "none"}
          </p>
          <ol className="mt-2 space-y-0.5 text-xs text-muted">
            {state.result.results.map((r) => (
              <li key={r.position} className="truncate" dir="ltr">
                {r.position}. {r.domain}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </form>
  );
}

export function ResumeChecksForm() {
  const [state, action] = useActionState(resumeRankChecks, initialFormState);
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <SubmitButton size="sm" variant="outline" pendingText="Resuming…">
        Resume now
      </SubmitButton>
    </form>
  );
}
