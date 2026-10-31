import { NextResponse, type NextRequest } from "next/server";
import { getAuditStatus, issuesCsv, pagesCsv } from "@/lib/audit/service";
import { getCurrentUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/projects";

/** CSV export of an audit: ?type=issues|pages&audit=<id> (the signed-in owner only). */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const project = /^\d{1,10}$/.test(id) ? await getOwnedProject(Number(id), user.id) : undefined;
  const audit = project ? await getAuditStatus(Number(request.nextUrl.searchParams.get("audit"))) : null;
  if (!project || !audit || audit.projectId !== project.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const type = request.nextUrl.searchParams.get("type") === "pages" ? "pages" : "issues";
  const csv = type === "pages" ? await pagesCsv(audit.id) : await issuesCsv(audit.id);
  const day = (audit.finishedAt ?? audit.createdAt).slice(0, 10);
  const name = `${project.domain.replace(/[^a-z0-9.-]/gi, "_")}-audit-${day}-${type}.csv`;
  // UTF-8 byte order mark so spreadsheet apps read non-English titles correctly.
  return new NextResponse(`${String.fromCharCode(0xfeff)}${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
