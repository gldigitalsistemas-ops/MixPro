import { Star } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";

export const metadata = { title: "Favoritos" };

type Row = { preset: { id: string; name: string; description: string | null; category: { name: string; position: number } | null } | null };

export default async function FavoritesPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("favorites")
    .select("preset:presets(id,name,description,category:preset_categories(name,position))")
    .order("created_at", { ascending: false });

  const groups = new Map<string, { position: number; items: NonNullable<Row["preset"]>[] }>();
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.preset) continue;
    const cat = r.preset.category?.name ?? "Outros";
    const g = groups.get(cat) ?? { position: r.preset.category?.position ?? 99, items: [] };
    g.items.push(r.preset);
    groups.set(cat, g);
  }
  const sorted = [...groups.entries()].sort((a, b) => a[1].position - b[1].position);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Meus favoritos</h1>
      {sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Star className="size-6" />}
            title="Nenhum favorito ainda"
            description="Ao testar presets num projeto, toque na estrela para guardar os que você mais gosta."
          />
        </Card>
      ) : (
        sorted.map(([cat, g]) => (
          <section key={cat} className="flex flex-col gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted">{cat}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((p) => (
                <Card key={p.id} className="flex items-center gap-3 p-4">
                  <Star className="size-4 shrink-0 fill-amber-300 text-amber-300" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted">{p.description}</p>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
