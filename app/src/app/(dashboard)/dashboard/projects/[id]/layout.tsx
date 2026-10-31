import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { ProjectTabs } from "@/components/dashboard/project-tabs";
import { Badge } from "@/components/ui/badge";
import { requireProject } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";

/** Frame of every project page: name, domain and the section tabs. */
export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ project }, t] = await Promise.all([requireProject(id), getT()]);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 dir="auto" className="truncate text-2xl font-bold">
            {project.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <a href={`https://${project.domain}`} target="_blank" rel="noopener noreferrer" dir="ltr" className="inline-flex items-center gap-1 hover:text-primary">
              {project.domain}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
            {project.status === "paused" ? <Badge tone="neutral">{t("dash.projects.paused")}</Badge> : null}
          </p>
        </div>
      </div>
      <div className="mb-6 overflow-x-auto">
        <ProjectTabs projectId={project.id} />
      </div>
      {children}
    </>
  );
}
