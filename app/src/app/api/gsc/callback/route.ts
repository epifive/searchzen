import { after, NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { listConnectionSites, saveConnection } from "@/lib/gsc/connections";
import { accountEmail, exchangeCode, GoogleApiError, GSC_SCOPE } from "@/lib/gsc/google";
import { STATE_COOKIE, verifyState } from "@/lib/gsc/oauth";
import { assignProperty, importFirstWindow, propertyKind, propertyMatchesDomain } from "@/lib/gsc/properties";
import { getEntitlements } from "@/lib/plans";
import { getOwnedProject } from "@/lib/projects";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";

/**
 * Google's redirect after the consent screen: checks the state (signature, expiry, user and the
 * cookie nonce), exchanges the code for tokens, stores the encrypted refresh token and, when
 * exactly one of the account's properties matches the project's domain, assigns it right away.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/dashboard", request.url));
  const verified = await verifyState(state, request.cookies.get(STATE_COOKIE)?.value, user.id);
  const project = verified ? await getOwnedProject(verified.projectId, user.id) : undefined;
  const target = (query: string) => {
    const res = NextResponse.redirect(new URL(project ? `/dashboard/projects/${project.id}/gsc?${query}` : `/dashboard?gsc=${query}`, request.url));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/gsc", maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  if (!verified || !project) return target("error=state");
  if (params.get("error")) return target("error=denied");
  const code = params.get("code");
  if (!code) return target("error=denied");
  if (!(await getEntitlements(user)).allowGsc) return target("error=plan");

  try {
    const settings = await getSettings();
    const tokens = await exchangeCode(code, absoluteUrl(settings, "/api/gsc/callback"));
    if (!tokens.scope.split(/\s+/).includes(GSC_SCOPE)) return target("error=scope");
    if (!tokens.refreshToken) return target("error=refresh");
    const email = await accountEmail(tokens);
    const connectionId = await saveConnection(user.id, email, tokens.refreshToken, tokens.scope);

    // Pick the property automatically when the choice is obvious.
    if (!project.gscProperty || project.gscConnectionId === null) {
      try {
        const matches = (await listConnectionSites(connectionId)).filter((s) => propertyMatchesDomain(s.siteUrl, project.domain));
        const domainProps = matches.filter((s) => propertyKind(s.siteUrl) === "domain");
        const pick = domainProps.length === 1 ? domainProps[0] : matches.length === 1 ? matches[0] : null;
        if (pick) {
          await assignProperty(project, connectionId, pick.siteUrl);
          after(() => importFirstWindow({ id: project.id, property: pick.siteUrl, connectionId }));
          return target("connected=1");
        }
      } catch {
        // The picker shows the error.
      }
    } else if (project.gscConnectionId === connectionId) {
      await assignProperty(project, connectionId, project.gscProperty);
    }
    return target("connected=1");
  } catch (error) {
    const kind = error instanceof GoogleApiError ? error.kind : "network";
    console.error("[searchzen] Search Console connect failed:", error instanceof Error ? error.message : error);
    return target(`error=${kind === "config" ? "client" : "google"}`);
  }
}
