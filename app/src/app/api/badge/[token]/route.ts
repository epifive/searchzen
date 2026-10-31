import { NextResponse, type NextRequest } from "next/server";
import { emailTranslator } from "@/lib/i18n/email";
import { getProjectByShareToken } from "@/lib/projects";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { badgeSvg, latestScore } from "@/lib/reports/badge";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";

/**
 * SEO health badge data for the embed script (public/sz-badge.js) and as an image:
 *   GET /api/badge/<share token>              → { score, label, url }   (JSON, CORS *)
 *   GET /api/badge/<share token>.svg          → SVG badge
 *   GET /api/badge/<share token>?format=svg   → SVG badge (&theme=dark, &label=…)
 * Uses the project's share token, so it only works while the report link is shared.
 * Responses are cached for 5 minutes by browsers and 10 by CDNs.
 */

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const CACHE = "public, max-age=300, s-maxage=600, stale-while-revalidate=3600";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const raw = (await params).token;
  const svg = raw.endsWith(".svg") || request.nextUrl.searchParams.get("format") === "svg";
  const token = raw.replace(/\.svg$/, "");
  const theme = request.nextUrl.searchParams.get("theme") === "dark" ? "dark" : "light";
  const ip = await clientIp();
  if (!rateLimit(`badge:${ip}`, 240, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { ...CORS, "Retry-After": "60" } });
  }
  const [project, { t }] = await Promise.all([getProjectByShareToken(token), emailTranslator()]);
  const label = (request.nextUrl.searchParams.get("label") ?? "").replace(/[\x00-\x1f]/g, "").trim().slice(0, 40) || t("rep.badge.label");
  if (!project) {
    if (svg) return new Response(badgeSvg(label, null, theme), { status: 404, headers: { ...CORS, "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=60" } });
    return NextResponse.json({ score: null, error: "Unknown or disabled badge." }, { status: 404, headers: { ...CORS, "Cache-Control": "public, max-age=60" } });
  }
  const score = await latestScore(project.id);
  if (svg) {
    return new Response(badgeSvg(label, score, theme), {
      headers: { ...CORS, "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": CACHE, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
    });
  }
  const settings = await getSettings();
  return NextResponse.json({ score, label, url: absoluteUrl(settings, `/r/${token}`) }, { headers: { ...CORS, "Cache-Control": CACHE } });
}
