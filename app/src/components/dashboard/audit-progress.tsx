"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { pollAuditAction, type AuditPoll } from "@/app/actions/dashboard/audits";
import { useT } from "@/lib/i18n/client";

const ACTIVE = new Set(["queued", "crawling", "analyzing"]);

/**
 * Live progress of a running audit. Polls the server every few seconds (each poll also crawls
 * a slice of the audit) and refreshes the page once the audit has finished.
 */
export function AuditProgress({ projectId, auditId, initial, locale }: { projectId: number; auditId: number; initial: AuditPoll; locale: string }) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<AuditPoll>(initial);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (stopped.current) return;
      try {
        const next = await pollAuditAction(projectId, auditId);
        if (stopped.current) return;
        if (next) {
          setState(next);
          if (!ACTIVE.has(next.status)) {
            router.refresh();
            return;
          }
        }
      } catch {
        // Network hiccup: try again on the next round.
      }
      timer = setTimeout(loop, 2_000);
    };
    timer = setTimeout(loop, 600);
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [projectId, auditId, router]);

  const n = (v: number) => v.toLocaleString(locale);
  // Against the page cap, or against what is known so far when the site is smaller than the cap.
  const target = Math.max(1, Math.min(state.pagesLimit > 0 ? state.pagesLimit : Infinity, state.pagesCrawled + state.queued));
  const pct = Math.min(100, Math.round((state.pagesCrawled / target) * 100));
  const line =
    state.status === "queued"
      ? t("audit.progress.queuedText")
      : state.status === "analyzing"
        ? t("audit.progress.analyzing", { n: n(state.pagesCrawled) })
        : t("audit.progress.pages", { n: n(state.pagesCrawled), limit: n(state.pagesLimit) });
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden />
          {line}
        </span>
        {state.status === "crawling" && state.queued > 0 ? <span className="text-muted">{t("audit.progress.queue", { n: n(state.queued) })}</span> : null}
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-line/70"
        role="progressbar"
        aria-label={t("audit.progress.title")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state.status === "analyzing" ? 100 : pct}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${state.status === "analyzing" ? 100 : Math.max(pct, state.status === "queued" ? 0 : 2)}%` }} />
      </div>
      <p className="text-xs text-muted">{t("audit.progress.keepOpen")}</p>
    </div>
  );
}
