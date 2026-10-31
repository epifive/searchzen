import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { ChannelForm, ChannelIcon } from "@/components/dashboard/channel-forms";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { requireDashboardUser } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { isChannelType } from "@/seo/normalize";
import { CHANNEL_TYPES } from "@/seo/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.channels.add") };
}

export default async function NewChannelPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireDashboardUser();
  const [query, t] = await Promise.all([searchParams, getT()]);
  const type = isChannelType(query.type) ? query.type : null;

  return (
    <>
      <Link href={type ? "/dashboard/channels/new" : "/dashboard/channels"} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {type ? t("dash.channels.changeType") : t("dash.nav.channels")}
      </Link>
      {type ? (
        <>
          <DashHeader title={t("dash.channels.addType", { type: t(`dash.channels.type.${type}` as MessageKey) })} description={t(`dash.channels.desc.${type}` as MessageKey)} />
          <Panel>
            <ChannelForm values={{ type, name: "", config: {}, isActive: true }} />
          </Panel>
        </>
      ) : (
        <>
          <DashHeader title={t("dash.channels.add")} description={t("dash.channels.pick")} />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CHANNEL_TYPES.map((ty) => {
              return (
                <li key={ty}>
                  <Link
                    href={`/dashboard/channels/new?type=${ty}`}
                    className="group flex h-full gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-primary-line hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                      <ChannelIcon type={ty} className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 font-semibold">
                        {t(`dash.channels.type.${ty}` as MessageKey)}
                        <ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden />
                      </span>
                      <span className="mt-1 block text-sm text-muted">{t(`dash.channels.desc.${ty}` as MessageKey)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
