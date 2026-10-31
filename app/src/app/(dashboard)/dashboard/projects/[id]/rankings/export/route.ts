import { getCurrentUser } from "@/lib/auth/session";
import { listProjectKeywords } from "@/lib/keywords";
import { getOwnedProject } from "@/lib/projects";
import { toCsv } from "@/lib/rank/csv";
import { getKeywordTrends } from "@/lib/rank/queries";
import { signedChange } from "@/seo/format";

export const dynamic = "force-dynamic";

/**
 * CSV export of a project's keywords with their latest positions and changes. The columns
 * keyword…target_url are the import format, so the file can be imported into another project.
 * Query: status (active / paused / all), tag, q.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("Not found", { status: 404 });
  const { id } = await params;
  const project = /^\d{1,10}$/.test(id) ? await getOwnedProject(Number(id), user.id) : undefined;
  if (!project) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const { keywords } = await listProjectKeywords(project.id, {
    status: status === "paused" ? "paused" : status === "all" ? undefined : "active",
    tag: url.searchParams.get("tag") ?? undefined,
    search: url.searchParams.get("q") ?? undefined,
    sort: "phrase",
    limit: 5000,
  });
  const trends = await getKeywordTrends(keywords);
  const rows: Array<Array<string | number | null>> = [
    ["keyword", "country", "language", "device", "location", "tags", "target_url", "status", "position", "change_1d", "change_7d", "change_30d", "best", "start", "url", "features", "last_checked"],
  ];
  for (const k of keywords) {
    const tr = trends.get(k.id);
    rows.push([
      k.phrase,
      k.country,
      k.language,
      k.device,
      k.location,
      k.tags.join("|"),
      k.targetUrl,
      k.status,
      k.lastCheckedAt ? (k.lastPosition ?? "") : "",
      tr?.d1 ? signedChange(tr.d1) : "",
      tr?.d7 ? signedChange(tr.d7) : "",
      tr?.d30 ? signedChange(tr.d30) : "",
      k.bestPosition,
      k.startPosition,
      k.lastUrl,
      k.lastFeatures.join("|"),
      k.lastCheckedAt,
    ]);
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${project.domain.replace(/[^a-z0-9.-]/gi, "_")}-keywords-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
