import { FolderOpen, Plus } from "lucide-react";
import { listProjects } from "@/lib/projects";
import { ProjectCard } from "@/components/projects/project-card";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";

export const metadata = { title: "Meus projetos" };

export default async function ProjectsPage() {
  const projects = await listProjects(200);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold">Meus projetos</h1>
        <ButtonLink href="/app/novo" size="sm">
          <Plus className="size-4" aria-hidden /> Novo projeto
        </ButtonLink>
      </div>
      {projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderOpen className="size-6" />}
            title="Nenhum projeto ainda"
            description="Crie um projeto para enviar seu áudio e testar sonoridades."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
