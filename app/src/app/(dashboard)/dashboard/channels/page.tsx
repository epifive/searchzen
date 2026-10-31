import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, Pencil, Plus, Send, Trash } from "lucide-react";
import { deleteChannelAction, testChannelAction, toggleChannelAction } from "@/app/actions/dashboard/channels";
import { ActionButton, RefreshOnce } from "@/components/dashboard/actions";
import { ChannelIcon } from "@/components/dashboard/channel-forms";
import { DashHeader, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { getChannelUsage, getUserChannels, type ChannelRecord } from "@/lib/channels";
import { requireDashboardUser } from "@/lib/dashboard";
import { formatList, listSeparator } from "@/lib/dash-format";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural, type MessageKey } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.channels") };
}

/** Short, safe summary of where a channel delivers (no secrets). */
function destination(c: ChannelRecord): string {
  const cfg = c.config as Record<string, string>;
  if (c.type === "email") return cfg.to;
  if (c.type === "telegram") return `chat ${cfg.chatId}`;
  const raw = c.type === "webhook" ? cfg.url : cfg.webhookUrl;
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname.length > 1 ? "/…" : ""}`;
  } catch {
    return "";
  }
}

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ created?: string; saved?: string; deleted?: string }> }) {
  const user = await requireDashboardUser();
  const [query, t, locale, channels, usage] = await Promise.all([searchParams, getT(), getLocale(), getUserChannels(user.id), getChannelUsage(user.id)]);
  const lc = locale.code;
  const notice = query.created === "1" ? t("dash.channels.created") : query.saved === "1" ? t("dash.channels.saved") : query.deleted === "1" ? t("dash.channels.deleted") : "";

  return (
    <>
      {notice ? (
        <>
          <RefreshOnce cleanUrl="/dashboard/channels" />
          <Alert tone="success" className="mb-6">
            {notice}
          </Alert>
        </>
      ) : null}
      <DashHeader
        title={t("dash.nav.channels")}
        description={t("dash.channels.subtitle")}
        actions={
          <ButtonLink href="/dashboard/channels/new">
            <Plus aria-hidden />
            {t("dash.channels.add")}
          </ButtonLink>
        }
      />
      <Panel padded={false}>
        {channels.length ? (
          <ul className="divide-y divide-line">
            {channels.map((c) => {
              const used = usage.get(c.id) ?? [];
              return (
                <li key={c.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                    <ChannelIcon type={c.type} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/channels/${c.id}`} dir="auto" className="font-medium hover:text-primary">
                        {c.name}
                      </Link>
                      <Badge>{t(`dash.channels.type.${c.type}` as MessageKey)}</Badge>
                      {!c.isActive ? <Badge tone="warning">{t("dash.channels.off")}</Badge> : null}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted" dir="ltr">
                      {destination(c)}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {used.length
                        ? plural(t, "dash.channels.usedBy", used.length, { names: used.length > 4 ? `${used.slice(0, 4).join(listSeparator(lc))}…` : formatList(used, lc) })
                        : t("dash.channels.unused")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionButton action={testChannelAction} fields={{ channel_id: c.id }} showSuccess>
                      <Send aria-hidden />
                      {t("dash.channels.test")}
                    </ActionButton>
                    <ActionButton action={toggleChannelAction} fields={{ channel_id: c.id, active: c.isActive ? "0" : "1" }}>
                      {c.isActive ? t("dash.channels.disable") : t("dash.channels.enable")}
                    </ActionButton>
                    <ButtonLink href={`/dashboard/channels/${c.id}`} variant="outline" size="sm" aria-label={t("dash.channels.editShort")} title={t("dash.channels.editShort")}>
                      <Pencil aria-hidden />
                    </ButtonLink>
                    <ActionButton
                      action={deleteChannelAction}
                      fields={{ channel_id: c.id }}
                      confirmText={t("dash.channels.deleteConfirm", { name: c.name })}
                      label={t("dash.channels.delete")}
                      buttonClassName="hover:border-red-300 hover:text-red-600"
                    >
                      <Trash aria-hidden />
                    </ActionButton>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty icon={<BellRing />} title={t("dash.channels.emptyTitle")} action={<ButtonLink href="/dashboard/channels/new">{t("dash.channels.add")}</ButtonLink>}>
            {t("dash.channels.emptyText")}
          </Empty>
        )}
      </Panel>
    </>
  );
}
