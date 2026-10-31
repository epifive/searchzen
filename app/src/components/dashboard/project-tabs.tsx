"use client";

import { usePathname } from "next/navigation";
import { LinkTabs } from "@/components/dashboard/ui";
import { useT } from "@/lib/i18n/client";
import { projectNav } from "./shell";

/** Tabs of a project page (Overview, Rankings, Audit, Search Console, Reports, Settings). */
export function ProjectTabs({ projectId }: { projectId: number }) {
  const t = useT();
  const pathname = usePathname();
  const items = projectNav(projectId).map((item) => ({
    href: item.href,
    label: t(item.label),
    active: item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`),
  }));
  return <LinkTabs items={items} label={t("dash.nav.projectSection")} />;
}
