import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/config";
import { buildAuthUrl, getGoogleCredentials } from "@/lib/gsc/google";
import { createState, STATE_COOKIE, STATE_TTL_MS } from "@/lib/gsc/oauth";
import { getEntitlements } from "@/lib/plans";
import { getOwnedProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";

/**
 * Starts the Search Console connection: GET /api/gsc/connect?project=<id> (signed-in owner, plan
 * with Search Console). Sets the state cookie and redirects to Google's consent screen, which
 * returns to /api/gsc/callback.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const projectParam = request.nextUrl.searchParams.get("project") ?? "";
  const projectId = /^\d{1,10}$/.test(projectParam) ? Number(projectParam) : NaN;
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/dashboard/projects/${projectParam}/gsc`)}`, request.url));
  const project = await getOwnedProject(projectId, user.id);
  if (!project) return NextResponse.redirect(new URL("/dashboard", request.url));
  const back = (error: string) => NextResponse.redirect(new URL(`/dashboard/projects/${project.id}/gsc?error=${error}`, request.url));
  if (isDemoMode()) return back("demo");
  if (!(await getEntitlements(user)).allowGsc) return back("plan");
  if (!(await getGoogleCredentials())) return back("config");
  if (!rateLimit(`gsc-connect:${user.id}`, 20, 60 * 60_000)) return back("rate");

  const settings = await getSettings();
  const { state, nonce } = await createState(user.id, project.id);
  const url = await buildAuthUrl(state, absoluteUrl(settings, "/api/gsc/callback"), request.nextUrl.searchParams.get("hint") ?? undefined);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    path: "/api/gsc",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
