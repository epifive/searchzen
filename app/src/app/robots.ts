import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = await getSettings();
  const extra = settings.robots_extra
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.toLowerCase().startsWith("disallow:"))
    .map((l) => l.slice("disallow:".length).trim())
    .filter(Boolean);
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/account", "/api/", "/checkout", "/dashboard", ...extra] }],
    sitemap: absoluteUrl(settings, "/sitemap.xml"),
  };
}
