import { ArrowRight, Gift, Headphones, Plus, SlidersHorizontal, UserRound } from "lucide-react";
import { requireSession } from "@/lib/supabase/server";
import { getBalance } from "@/lib/queries";
import { listProjects } from "@/lib/projects";
import { ProjectCard } from "@/components/projects/project-card";
import { ProcessorStatus } from "@/components/audio/processor-status";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import Link from "next/link";

export const metadata = { title: "Início" };

export default async function Dashboard() {
  const session = await requireSession();
  const [balance, projects] = await Promise.all([getBalance(), listProjects(8)]);
  const first = (session.profile.display_name ?? "").split(" ")[0];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold md:text-3xl">{first ? `Olá, ${first}!` : "Olá!"}</h1>
        <p className="text-muted">O que você quer fazer hoje?</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2" aria-label="Escolha um caminho">
        <Card className="relative overflow-hidden p-6">
          <div className="absolute -right-10 -top-10 size-40 rounded-full bg-primary/25 blur-3xl" aria-hidden />
          <div className="grid size-11 place-items-center rounded-xl bg-primary/20 text-violet-300">
            <SlidersHorizontal className="size-5" aria-hidden />
          </div>
          <h2 className="mt-4 font-display text-xl font-semibold">Faça você mesmo</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">
            Envie seu áudio, teste sonoridades profissionais, compare antes e depois e baixe o resultado.
          </p>
          <ButtonLink href="/app/novo" className="mt-5">
            <Plus className="size-4" aria-hidden /> Novo projeto
          </ButtonLink>
        </Card>

        <Card className="relative overflow-hidden p-6">
          <div className="absolute -right-10 -top-10 size-40 rounded-full bg-pink/20 blur-3xl" aria-hidden />
          <div className="grid size-11 place-items-center rounded-xl bg-pink/15 text-fuchsia-300">
            <UserRound className="size-5" aria-hidden />
          </div>
          <h2 className="mt-4 flex items-center gap-2 font-display text-xl font-semibold">
            Contrate uma mixagem <Badge tone="neutral">Em breve</Badge>
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted">
            Envie suas pistas e deixe a mixagem com um profissional. Personalizada, com revisão incluída.
          </p>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="flex items-center gap-4 p-5 md:col-span-2">
          <div className="grid size-11 place-items-center rounded-xl bg-blue/15 text-blue-300">
            <Gift className="size-5" aria-hidden />
          </div>
          <div className="flex-1">
            <p className="font-medium">
              Você possui <span className="text-gradient font-semibold">{balance}</span>{" "}
              {balance === 1 ? "download disponível" : "downloads disponíveis"}
            </p>
            <p className="text-sm text-muted">Ouvir previews e testar presets é ilimitado. Só o download final consome crédito.</p>
          </div>
        </Card>
        <Card className="p-5">
          <ProcessorStatus />
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <CardHeader
          title="Meus projetos"
          action={
            projects.length > 0 && (
              <Link href="/app/projetos" className="flex items-center gap-1 text-sm text-muted hover:text-text">
                Ver todos <ArrowRight className="size-4" aria-hidden />
              </Link>
            )
          }
        />
        {projects.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Headphones className="size-6" />}
              title="Vamos criar seu primeiro som"
              description="Escolha o tipo de áudio, envie o arquivo e experimente as sonoridades. Leva menos de um minuto."
              action={
                <ButtonLink href="/app/novo" className="mt-2">
                  <Plus className="size-4" aria-hidden /> Começar agora
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {projects.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
