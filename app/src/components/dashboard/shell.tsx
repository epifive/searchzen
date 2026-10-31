"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  Check,
  ChevronsUpDown,
  CircleUser,
  Crown,
  FileText,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  MousePointerClick,
  Plus,
  ScanSearch,
  Settings2,
  Shield,
  Sparkles,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/site/logo";
import { ThemeToggle, type ThemeChoice } from "@/components/site/theme";
import { formatNumber } from "@/lib/dash-format";
import { useT } from "@/lib/i18n/client";
import { plural, type MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

export interface ShellBanner {
  tone: "warning" | "danger";
  text: string;
}

export interface ShellProject {
  id: number;
  name: string;
  domain: string;
}

export interface ShellUsage {
  /** Tracked keywords (all projects). */
  used: number;
  /** 0 = unlimited. */
  limit: number;
}

export interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  exact?: boolean;
  /** Extra paths that also mark the item active. */
  also?: string[];
}

const WORKSPACE_NAV: NavItem[] = [
  { href: "/dashboard/channels", label: "dash.nav.channels", icon: BellRing },
  { href: "/dashboard/api-keys", label: "dash.nav.apiKeys", icon: KeyRound },
];

/** Pages of one project (/dashboard/projects/<id>/…). */
export function projectNav(id: number): NavItem[] {
  const base = `/dashboard/projects/${id}`;
  return [
    { href: base, label: "dash.nav.projectOverview", icon: LayoutDashboard, exact: true },
    { href: `${base}/rankings`, label: "dash.nav.rankings", icon: LineChart },
    { href: `${base}/audit`, label: "dash.nav.audit", icon: ScanSearch },
    { href: `${base}/gsc`, label: "dash.nav.gsc", icon: MousePointerClick },
    { href: `${base}/reports`, label: "dash.nav.reports", icon: FileText },
    { href: `${base}/settings`, label: "dash.nav.projectSettings", icon: Settings2 },
  ];
}

const navLink = (active: boolean) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
    active ? "bg-primary-soft text-primary" : "text-muted hover:bg-paper hover:text-ink",
  );

function isActive(pathname: string, item: NavItem): boolean {
  if (item.also?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function ProjectAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("grid size-7 shrink-0 place-items-center rounded-md bg-primary-soft text-xs font-bold text-primary uppercase", className)} aria-hidden>
      {(name || "?").slice(0, 1)}
    </span>
  );
}

/** Dropdown to jump between projects (and add one). */
function ProjectSwitcher({ projects, currentId }: { projects: ShellProject[]; currentId: number | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = projects.find((s) => s.id === currentId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative px-3 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-paper px-2.5 py-2 text-start transition-colors hover:border-primary-line focus-visible:outline-2 focus-visible:outline-primary"
      >
        {current ? <ProjectAvatar name={current.name} /> : <LayoutDashboard className="size-5 shrink-0 text-muted" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-sm font-semibold">
            {current ? current.name : t("dash.nav.allProjects")}
          </span>
          <span dir="ltr" className="block truncate text-xs text-muted">
            {current ? current.domain : plural(t, "dash.nav.projectsCount", projects.length, { n: projects.length })}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
      {open ? (
        <div className="absolute inset-x-3 top-full z-40 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <ul className="max-h-72 overflow-y-auto p-1">
            {projects.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/dashboard/projects/${s.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-paper"
                  aria-current={s.id === currentId ? "page" : undefined}
                >
                  <ProjectAvatar name={s.name} className="size-6" />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate font-medium">
                      {s.name}
                    </span>
                    <span dir="ltr" className="block truncate text-xs text-muted">
                      {s.domain}
                    </span>
                  </span>
                  {s.id === currentId ? <Check className="size-4 text-primary" aria-hidden /> : null}
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-1">
            <Link href="/dashboard#new-project" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-primary hover:bg-primary-soft">
              <Plus className="size-4" aria-hidden />
              {t("dash.projects.add")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DashboardShell({
  siteName,
  logo,
  logoDark,
  user,
  projects,
  usage,
  locale,
  banner,
  demo,
  defaultTheme,
  isPremium,
  children,
}: {
  siteName: string;
  logo: string;
  logoDark: string;
  user: { name: string; email: string; isAdmin: boolean };
  projects: ShellProject[];
  usage: ShellUsage;
  locale: string;
  banner: ShellBanner | null;
  demo: boolean;
  defaultTheme: ThemeChoice;
  isPremium: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  // Close the drawer after each navigation (derived state, no effect needed).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const match = /^\/dashboard\/projects\/(\d+)(?:\/|$)/.exec(pathname);
  const currentId = match ? Number(match[1]) : null;
  const currentProject = currentId ? projects.find((s) => s.id === currentId) : undefined;

  const renderItems = (items: NavItem[]) => (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link href={item.href} aria-current={active ? "page" : undefined} className={navLink(active)}>
              <item.icon className="size-[18px]" aria-hidden />
              <span className="flex-1">{t(item.label)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const sectionTitle = (text: string) => <p className="mt-5 mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted/80 uppercase">{text}</p>;

  const nav = (
    <>
      {projects.length ? <ProjectSwitcher projects={projects} currentId={currentId} /> : null}
      <nav aria-label={t("dash.nav.label")} className="flex-1 overflow-y-auto px-3 pt-3 pb-4">
        {renderItems([{ href: "/dashboard", label: "dash.nav.projects", icon: FolderKanban, exact: true }])}
        {currentProject ? (
          <>
            {sectionTitle(t("dash.nav.projectSection"))}
            {renderItems(projectNav(currentProject.id))}
          </>
        ) : null}
        {sectionTitle(t("dash.nav.workspace"))}
        {renderItems(WORKSPACE_NAV)}
      </nav>
    </>
  );

  const ratio = usage.limit > 0 ? Math.min(1, usage.used / usage.limit) : 0;
  const usageBox = (
    <div className="mx-3 mb-2 rounded-lg border border-line bg-paper px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{t("dash.usage.title")}</span>
        {usage.limit > 0 ? (
          <span className="text-muted tabular-nums">
            <bdi>{formatNumber(usage.used, locale)}</bdi>
            {" / "}
            <bdi>{formatNumber(usage.limit, locale)}</bdi>
          </span>
        ) : null}
      </div>
      {usage.limit > 0 ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/70"
          role="meter"
          aria-label={t("dash.usage.title")}
          aria-valuemin={0}
          aria-valuemax={usage.limit}
          aria-valuenow={Math.min(usage.used, usage.limit)}
        >
          <div className={cn("h-full rounded-full", ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-primary")} style={{ width: `${Math.max(ratio * 100, usage.used > 0 ? 2 : 0)}%` }} />
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-muted">{t("dash.usage.unlimitedCount", { n: formatNumber(usage.used, locale) })}</p>
      )}
    </div>
  );

  const footer = (
    <div className="border-t border-line pt-3">
      {usageBox}
      <div className="space-y-0.5 px-3 pb-3">
        <Link href="/account" className={navLink(pathname === "/account")}>
          <CircleUser className="size-[18px]" aria-hidden />
          {t("dash.nav.account")}
        </Link>
        <Link href="/pricing" className={navLink(false)}>
          {isPremium ? <Sparkles className="size-[18px]" aria-hidden /> : <Crown className="size-[18px] text-amber-500" aria-hidden />}
          {isPremium ? t("dash.nav.pricing") : t("dash.nav.upgrade")}
        </Link>
        {user.isAdmin ? (
          <Link href="/admin" className={navLink(false)}>
            <Shield className="size-[18px]" aria-hidden />
            {t("nav.admin")}
          </Link>
        ) : null}
        <div className="mt-2 flex items-center gap-2 border-t border-line px-1 pt-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary uppercase" aria-hidden>
            {(user.name || user.email).slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate text-sm font-medium">
              {user.name}
            </p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <ThemeToggle defaultTheme={defaultTheme} />
          <form action={logout}>
            <button
              type="submit"
              aria-label={t("nav.signOut")}
              title={t("nav.signOut")}
              className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-primary-soft hover:text-ink"
            >
              <LogOut className="size-[18px] rtl:rotate-180" aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <a
        href="#dash-main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
      >
        {t("nav.skipToContent")}
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-e border-line bg-surface lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-line px-5">
          <Logo siteName={siteName} logo={logo} logoDark={logoDark} href="/dashboard" />
        </div>
        {nav}
        {footer}
      </aside>

      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("nav.openMenu")}
          aria-expanded={open}
          className="grid size-9 place-items-center rounded-lg text-muted hover:bg-primary-soft hover:text-ink"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <Logo siteName={siteName} logo={logo} logoDark={logoDark} href="/dashboard" />
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("dash.nav.label")}>
          <button type="button" aria-label={t("nav.closeMenu")} onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 start-0 flex w-[min(20rem,88vw)] flex-col overflow-y-auto bg-surface shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
              <Logo siteName={siteName} logo={logo} logoDark={logoDark} href="/dashboard" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("nav.closeMenu")}
                className="grid size-9 place-items-center rounded-lg text-muted hover:bg-primary-soft hover:text-ink"
                autoFocus
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      ) : null}

      <main id="dash-main" className="min-w-0">
        {demo ? <p className="bg-marker px-4 py-2 text-center text-sm font-medium text-[#3d2e00]">{t("dash.demo")}</p> : null}
        {banner ? (
          <div
            role="status"
            className={cn(
              "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-center text-sm",
              banner.tone === "danger"
                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
            )}
          >
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            <span>{banner.text}</span>
            <Link href="/pricing" className="font-semibold underline underline-offset-2">
              {t("dash.banner.cta")}
            </Link>
          </div>
        ) : null}
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
