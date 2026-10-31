import "server-only";
import { getDb, now } from "./db";
import type { Post } from "./db/schema";

export type PostSummary = Pick<Post, "id" | "slug" | "title" | "excerpt" | "cover_image" | "published_at" | "content">;

const SUMMARY_COLUMNS = ["id", "slug", "title", "excerpt", "cover_image", "published_at", "content"] as const;

/** Published posts whose publish date has passed, newest first. */
export async function getPublishedPosts(page = 1, perPage = 12): Promise<{ posts: PostSummary[]; total: number }> {
  const db = await getDb();
  const base = db.selectFrom("posts").where("status", "=", "published").where("published_at", "<=", now());
  const [rows, count] = await Promise.all([
    base
      .select([...SUMMARY_COLUMNS])
      .orderBy("published_at", "desc")
      .limit(perPage)
      .offset((page - 1) * perPage)
      .execute(),
    base.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
  ]);
  return { posts: rows, total: Number(count?.n ?? 0) };
}

export async function getLatestPosts(limit: number, excludeId?: number): Promise<PostSummary[]> {
  const db = await getDb();
  return db
    .selectFrom("posts")
    .select([...SUMMARY_COLUMNS])
    .where("status", "=", "published")
    .where("published_at", "<=", now())
    .$if(excludeId !== undefined, (qb) => qb.where("id", "!=", excludeId!))
    .orderBy("published_at", "desc")
    .limit(limit)
    .execute();
}

export async function getPublishedPost(slug: string): Promise<Post | undefined> {
  const db = await getDb();
  return db
    .selectFrom("posts")
    .selectAll()
    .where("slug", "=", slug)
    .where("status", "=", "published")
    .where("published_at", "<=", now())
    .executeTakeFirst();
}

export async function countPostView(id: number): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("posts")
    .set((eb) => ({ views: eb("views", "+", 1) }))
    .where("id", "=", id)
    .execute();
}

/** Estimated reading time in minutes (at 220 words per minute). */
export function readingMinutes(markdown: string): number {
  const words = markdown.replace(/[#*_>`[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
