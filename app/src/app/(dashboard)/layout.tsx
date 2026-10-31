import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DashboardShell, type ShellBanner } from "@/components/dashboard/shell";
import { BrandStyle } from "@/components/site/brand-style";
import { HtmlLang } from "@/components/site/html-lang";
import type { ThemeChoice } from "@/components/site/theme";
import { isDemoMode } from "@/lib/config";
import { requireDashboardUser } from "@/lib/dashboard";
import { formatNumber } from "@/lib/dash-format";
import { I18nProvider } from "@/lib/i18n/client";
import { getClientMessages, getLocale, getT } from "@/lib/i18n/server";
import { maybeLazyTick } from "@/lib/lazy-tick";
import { countUserKeywords } from "@/lib/keywords";
import { getEntitlements } from "@/lib/plans";
import { getUserProjects } from "@/lib/projects";
import { getSettings } from "@/lib/settings";
import { uploadUrl } from "@/lib/site";

// Every dashboard page reads the signed-in user's data at request time.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [settings, t] = await Promise.all([getSettings(), getT()]);
  const favicon = uploadUrl(settings.favicon);
  return {
    title: { default: t("dash.title"), template: `%s${settings.title_separator}${settings.site_name}` },
    robots: { index: false, follow: false },
    icons: favicon ? { icon: favicon, apple: favicon } : { icon: "/icon.svg" },
  };
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireDashboardUser();
  // Without a cron job, background jobs also run when people use the app.
  Promise.resolve()
    .then(() => maybeLazyTick())
    .catch(() => {});

  const [settings, locale, messages, entitlements, projects, used, t] = await Promise.all([
    getSettings(),
    getLocale(),
    getClientMessages(),
    getEntitlements(user),
    getUserProjects(user.id),
    countUserKeywords(user.id),
    getT(),
  ]);

  // Tracked keywords against the plan's limit (the usage meter in the sidebar shows the same).
  const limit = entitlements.maxKeywords;
  let banner: ShellBanner | null = null;
  if (limit > 0 && used >= limit) {
    banner = { tone: "danger", text: t("dash.banner.keywordsFull", { limit: formatNumber(limit, locale.code) }) };
  } else if (limit > 0 && used >= limit * 0.8) {
    banner = { tone: "warning", text: t("dash.banner.keywordsNear", { pct: Math.floor((used / limit) * 100), limit: formatNumber(limit, locale.code) }) };
  }

  return (
    <I18nProvider messages={messages}>
      <HtmlLang code={locale.code} dir={locale.dir} />
      <BrandStyle color={settings.primary_color} />
      <div dir={locale.dir} lang={locale.code}>
        <DashboardShell
          siteName={settings.site_name}
          logo={uploadUrl(settings.logo)}
          logoDark={uploadUrl(settings.logo_dark)}
          user={{ name: user.name, email: user.email, isAdmin: user.role === "admin" }}
          projects={projects.map((p) => ({ id: p.id, name: p.name, domain: p.domain }))}
          usage={{ used, limit }}
          locale={locale.code}
          banner={banner}
          demo={isDemoMode()}
          defaultTheme={settings.default_theme as ThemeChoice}
          isPremium={entitlements.isPremium}
        >
          {children}
        </DashboardShell>
      </div>
    </I18nProvider>
  );
}
