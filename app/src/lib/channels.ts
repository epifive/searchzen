import "server-only";
import { getDb, now } from "./db";
import type { AlertChannel } from "./db/schema";
import { isChannelType, normalizeChannelConfig, normalizeProjectSettings, parseJson } from "@/seo/normalize";
import type { ChannelConfigByType, ChannelType } from "@/seo/types";

/** Alert channels (email, webhook, Slack, Discord, Teams, Telegram) owned by a user. */
export interface ChannelRecord<T extends ChannelType = ChannelType> {
  id: number;
  userId: number;
  type: T;
  name: string;
  config: ChannelConfigByType[T];
  isActive: boolean;
  createdAt: string;
}

export function toChannelRecord(row: AlertChannel): ChannelRecord | null {
  if (!isChannelType(row.type)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    name: row.name,
    config: normalizeChannelConfig(row.type, parseJson(row.config)),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

const records = (rows: AlertChannel[]) => rows.map(toChannelRecord).filter((c): c is ChannelRecord => c !== null);

export async function getUserChannels(userId: number): Promise<ChannelRecord[]> {
  const db = await getDb();
  return records(await db.selectFrom("alert_channels").selectAll().where("user_id", "=", userId).orderBy("id").execute());
}

export async function getOwnedChannel(channelId: number, userId: number): Promise<ChannelRecord | undefined> {
  if (!Number.isInteger(channelId) || channelId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("alert_channels").selectAll().where("id", "=", channelId).where("user_id", "=", userId).executeTakeFirst();
  return row ? (toChannelRecord(row) ?? undefined) : undefined;
}

/** The ids from `ids` that belong to `userId` (use it for ids from user input). */
export async function ownedChannelIds(ids: number[], userId: number): Promise<number[]> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20);
  if (!clean.length) return [];
  const db = await getDb();
  const rows = await db.selectFrom("alert_channels").select("id").where("user_id", "=", userId).where("id", "in", clean).execute();
  const owned = new Set(rows.map((r) => r.id));
  return clean.filter((id) => owned.has(id));
}

/** Active channels among `ids` that belong to `userId` (used when sending alerts). */
export async function getActiveChannels(ids: number[], userId: number): Promise<ChannelRecord[]> {
  if (!ids.length) return [];
  const db = await getDb();
  const rows = await db
    .selectFrom("alert_channels")
    .selectAll()
    .where("id", "in", ids.slice(0, 20))
    .where("user_id", "=", userId)
    .where("is_active", "=", 1)
    .orderBy("id")
    .execute();
  return records(rows);
}

/** channel id → names of the projects that notify it (for the channel list). */
export async function getChannelUsage(userId: number): Promise<Map<number, string[]>> {
  const db = await getDb();
  const rows = await db.selectFrom("projects").select(["name", "settings"]).where("user_id", "=", userId).orderBy("id").execute();
  const usage = new Map<number, string[]>();
  for (const row of rows) {
    for (const id of normalizeProjectSettings(parseJson(row.settings)).alertChannelIds) {
      const list = usage.get(id) ?? [];
      if (!list.includes(row.name)) list.push(row.name);
      usage.set(id, list);
    }
  }
  return usage;
}

export async function createChannel<T extends ChannelType>(userId: number, type: T, name: string, config: unknown): Promise<number> {
  const db = await getDb();
  const ts = now();
  const result = await db
    .insertInto("alert_channels")
    .values({ user_id: userId, type, name: name.trim().slice(0, 120) || type, config: JSON.stringify(normalizeChannelConfig(type, config)), is_active: 1, created_at: ts, updated_at: ts })
    .executeTakeFirstOrThrow();
  return Number(result.insertId);
}

export async function updateChannel(channel: Pick<ChannelRecord, "id" | "type">, input: { name?: string; config?: unknown; isActive?: boolean }): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("alert_channels")
    .set({
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 120) || channel.type } : {}),
      ...(input.config !== undefined ? { config: JSON.stringify(normalizeChannelConfig(channel.type, input.config)) } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive ? 1 : 0 } : {}),
      updated_at: now(),
    })
    .where("id", "=", channel.id)
    .execute();
}

/** Delete a channel and remove it from the owner's projects. */
export async function deleteChannel(channel: Pick<ChannelRecord, "id" | "userId">): Promise<void> {
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    const projects = await trx.selectFrom("projects").select(["id", "domain", "settings"]).where("user_id", "=", channel.userId).execute();
    for (const project of projects) {
      const settings = normalizeProjectSettings(parseJson(project.settings), project.domain);
      if (!settings.alertChannelIds.includes(channel.id)) continue;
      settings.alertChannelIds = settings.alertChannelIds.filter((id) => id !== channel.id);
      await trx.updateTable("projects").set({ settings: JSON.stringify(settings) }).where("id", "=", project.id).execute();
    }
    await trx.updateTable("alert_log").set({ channel_id: null }).where("channel_id", "=", channel.id).execute();
    await trx.deleteFrom("alert_channels").where("id", "=", channel.id).execute();
  });
}

export async function logAlert(entry: { projectId: number | null; channelId: number | null; event: string; ok: boolean; error?: string | null }): Promise<void> {
  const db = await getDb();
  await db
    .insertInto("alert_log")
    .values({ project_id: entry.projectId, channel_id: entry.channelId, event: entry.event, ok: entry.ok ? 1 : 0, error: entry.error ? entry.error.slice(0, 500) : null, created_at: now() })
    .execute();
}
