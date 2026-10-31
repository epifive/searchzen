import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Send, Trash } from "lucide-react";
import { deleteChannelAction, testChannelAction } from "@/app/actions/dashboard/channels";
import { ActionButton } from "@/components/dashboard/actions";
import { ChannelForm } from "@/components/dashboard/channel-forms";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { getOwnedChannel } from "@/lib/channels";
import { requireDashboardUser } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.channels.edit") };
}

export default async function EditChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDashboardUser();
  const channel = await getOwnedChannel(Number((await params).id), user.id);
  if (!channel) notFound();
  const t = await getT();
  return (
    <>
      <Link href="/dashboard/channels" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("dash.nav.channels")}
      </Link>
      <DashHeader
        title={channel.name}
        description={t(`dash.channels.type.${channel.type}` as MessageKey)}
        actions={
          <>
            <ActionButton action={testChannelAction} fields={{ channel_id: channel.id }} showSuccess>
              <Send aria-hidden />
              {t("dash.channels.test")}
            </ActionButton>
            <ActionButton
              action={deleteChannelAction}
              fields={{ channel_id: channel.id }}
              confirmText={t("dash.channels.deleteConfirm", { name: channel.name })}
              label={t("dash.channels.delete")}
              buttonClassName="hover:border-red-300 hover:text-red-600"
            >
              <Trash aria-hidden />
            </ActionButton>
          </>
        }
      />
      <Panel>
        <ChannelForm
          values={{ id: channel.id, type: channel.type, name: channel.name, config: channel.config as unknown as Record<string, string>, isActive: channel.isActive }}
        />
      </Panel>
    </>
  );
}
