"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { unlockReportAction } from "@/app/r/[token]/actions";
import { initialFormState } from "@/app/actions/types";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";

/** Password prompt of a protected report link. */
export function ReportGate({ token, labels }: { token: string; labels: { title: string; text: string; password: string; submit: string; checking: string } }) {
  const router = useRouter();
  const [state, action] = useActionState(unlockReportAction, initialFormState);
  useEffect(() => {
    if (state.success) router.refresh();
  }, [state, router]);
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-4">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <span className="grid size-11 place-items-center rounded-full bg-primary-soft text-primary">
          <LockKeyhole className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold">{labels.title}</h1>
          <p className="mt-1 text-sm text-muted">{labels.text}</p>
        </div>
        <input type="hidden" name="token" value={token} />
        <Field label={labels.password} htmlFor="report-password">
          <Input id="report-password" name="password" type="password" required autoFocus autoComplete="current-password" />
        </Field>
        {state.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : null}
        <SubmitButton className="w-full" pendingText={labels.checking}>
          {labels.submit}
        </SubmitButton>
      </form>
    </div>
  );
}
