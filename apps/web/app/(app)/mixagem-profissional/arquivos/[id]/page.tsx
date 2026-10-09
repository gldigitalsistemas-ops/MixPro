import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, FolderOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/supabase/server";
import { proObjects } from "@/lib/pro/deps";
import { proFiles } from "@/lib/pro/uploads";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Arquivos da mixagem", robots: { index: false } };

const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

/** Faixas enviadas pelo app para a Mixagem Profissional (só o dono e o admin abrem). */
export default async function ProFilesPage(props: PageProps<"/mixagem-profissional/arquivos/[id]">) {
  const { id } = await props.params;
  const session = await requireSession(`/mixagem-profissional/arquivos/${id}`);
  const objects = proObjects();
  const data = objects ? await proFiles(objects, id, { userId: session.userId, admin: session.profile.role === "admin" }).catch(() => null) : null;
  if (!data) notFound();
  const total = data.files.reduce((a, f) => a + f.bytes, 0);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="bg-brand grid size-11 place-items-center rounded-2xl text-white">
          <FolderOpen className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold">Arquivos da mixagem</h1>
          <p className="text-sm text-muted">
            {data.files.length} arquivo{data.files.length > 1 ? "s" : ""} · {size(total)} · guardados por 30 dias desde o envio
          </p>
        </div>
      </div>
      <Card className="divide-y divide-border p-0">
        {data.files.map((f) => (
          <a key={f.url} href={f.url} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/5">
            <Download className="size-4 shrink-0 text-violet-300" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="text-xs text-muted">{size(f.bytes)}</span>
          </a>
        ))}
      </Card>
      <p className="text-xs text-subtle">Os links de download valem 1 hora; recarregue a página para gerar novos.</p>
    </div>
  );
}
