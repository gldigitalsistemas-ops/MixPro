import Link from "next/link";
import { Plus } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import type { PresetChain } from "@mixpro/contracts";

export const metadata = { title: "Presets" };

type Row = {
  id: string;
  name: string;
  slug: string;
  style: string | null;
  active: boolean;
  archived_at: string | null;
  category_id: string;
  version: { version: number; chain: PresetChain } | null;
};

export default async function AdminPresets(props: PageProps<"/admin/presets">) {
  const sp = await props.searchParams;
  const showArchived = sp.arquivados === "1";
  const supabase = await supabaseServer();
  const [{ data: cats }, { data }] = await Promise.all([
    supabase.from("preset_categories").select("id,name,position").order("position"),
    supabase
      .from("presets")
      .select("id,name,slug,style,active,archived_at,category_id,version:preset_versions!presets_current_version_fk(version,chain)")
      .order("position"),
  ]);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => (showArchived ? r.archived_at : !r.archived_at));
  const pending = rows.filter((r) => !r.version?.chain?.chain?.length).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Presets</h1>
          <p className="text-sm text-muted">
            {rows.length} presets · {pending} sem parâmetros definidos. Presets só aparecem para usuários quando ativos e com cadeia
            configurada.
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href={showArchived ? "/admin/presets" : "/admin/presets?arquivados=1"} variant="ghost" size="sm">
            {showArchived ? "Ver ativos" : "Ver arquivados"}
          </ButtonLink>
          <ButtonLink href="/admin/presets/novo" size="sm">
            <Plus className="size-4" aria-hidden /> Novo preset
          </ButtonLink>
        </div>
      </div>

      {(cats ?? []).map((c) => {
        const items = rows.filter((r) => r.category_id === c.id);
        if (!items.length) return null;
        return (
          <section key={c.id} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted">{c.name}</h2>
            <Card className="divide-y divide-border overflow-hidden">
              {items.map((p) => {
                const steps = p.version?.chain?.chain?.length ?? 0;
                return (
                  <Link key={p.id} href={`/admin/presets/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-white/[0.03]">
                    <span className="min-w-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-subtle">
                        v{p.version?.version ?? "—"} · {steps} {steps === 1 ? "módulo" : "módulos"}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      {steps === 0 && <Badge tone="warning">Sem parâmetros</Badge>}
                      <Badge tone={p.active ? "success" : "neutral"}>{p.active ? "Ativo" : "Inativo"}</Badge>
                    </span>
                  </Link>
                );
              })}
            </Card>
          </section>
        );
      })}
    </div>
  );
}
