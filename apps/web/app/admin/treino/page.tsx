import { CheckCircle2, Circle } from "lucide-react";
import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { formatDate } from "@/lib/cn";
import { SHOWCASE_TARGETS, TRAINING_GENRES, TRAINING_STEPS } from "@/lib/premium/training";
import { TrainingList, TrainingUpload, type TrainingRow } from "@/components/premium/admin-training";

export const metadata = { title: "Mapa de treino" };
export const dynamic = "force-dynamic";

/**
 * Mapa de treino (só admin): o que juntar para os treinos por gênero do gerador de bases e para calibrar o
 * motor de mixagem, e os exemplos da vitrine antes de abrir para todos — em forma de tarefas.
 */
export default async function AdminTreino() {
  await requireAdmin();
  const admin = supabaseAdmin();
  const [{ data: assets }, { data: showcase }] = await Promise.all([
    admin.from("training_assets").select("id,genre,title,artist,source,status,files,created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("showcase_items").select("product,status,user_id").eq("status", "approved"),
  ]);
  const rows: TrainingRow[] = (assets ?? []).map((a) => {
    const files = (a.files ?? []) as { kind: string }[];
    return { id: a.id, genre: a.genre, title: a.title, artist: a.artist, source: a.source, status: a.status, files: files.length, stems: files.filter((f) => f.kind === "stem").length, created: formatDate(a.created_at) };
  });
  const usable = (g: string) => rows.filter((r) => r.genre === g && r.status !== "rejected");
  const shown = (p: string) => (showcase ?? []).filter((s) => s.product === p).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Mapa de treino</h1>
        <p className="max-w-3xl text-sm text-muted">
          Suas produções e as de parceiros ensinam a IA: o gerador de bases aprende cada estilo brasileiro (treino por gênero) e o motor de mixagem aprende o
          equilíbrio de volume e timbre de mixes reais. Quanto mais músicas com <strong>faixas separadas</strong>, melhor. Os arquivos ficam guardados só para isso.
        </p>
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-lg font-semibold">Para cada música</h2>
        <ol className="grid gap-2 md:grid-cols-5">
          {TRAINING_STEPS.map((s) => (
            <li key={s.id} className="rounded-2xl border border-border p-3 text-sm">
              <p className="font-semibold">{s.title}</p>
              <p className="text-xs text-muted">{s.detail}</p>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-display text-lg font-semibold">Tarefa 1 · Músicas por gênero</h2>
          <p className="text-xs text-muted">O treino de um gênero pode começar com o mínimo; a meta deixa o estilo realmente bom.</p>
          {TRAINING_GENRES.map((g) => {
            const n = usable(g.id).length;
            const withStems = usable(g.id).filter((r) => r.stems > 0).length;
            return (
              <div key={g.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    {n >= g.minimum ? <CheckCircle2 className="size-4 text-emerald-400" aria-hidden /> : <Circle className="size-4 text-muted" aria-hidden />}
                    {g.name}
                  </span>
                  <span className="text-xs text-muted">
                    {n}/{g.target} (mínimo {g.minimum}) · {withStems} com faixas
                  </span>
                </div>
                <ProgressBar value={Math.min(100, (n / g.target) * 100)} label={`${g.name}: ${n} de ${g.target}`} />
                <p className="text-[11px] text-subtle">{g.why}</p>
              </div>
            );
          })}
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-display text-lg font-semibold">Tarefa 2 · Exemplos na vitrine</h2>
          <p className="text-xs text-muted">Antes de divulgar, deixe estes exemplos na vitrine (Admin → Vitrine → Enviar um exemplo seu, ou use o próprio módulo e autorize).</p>
          {SHOWCASE_TARGETS.map((t) => {
            const n = shown(t.product);
            return (
              <div key={t.product} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    {n >= t.target ? <CheckCircle2 className="size-4 text-emerald-400" aria-hidden /> : <Circle className="size-4 text-muted" aria-hidden />}
                    {t.name}
                  </span>
                  <span className="text-xs text-muted">
                    {n}/{t.target}
                  </span>
                </div>
                <ProgressBar value={Math.min(100, (n / t.target) * 100)} label={`${t.name}: ${n} de ${t.target}`} />
              </div>
            );
          })}
          <h2 className="mt-2 font-display text-lg font-semibold">Tarefa 3 · Teste cego</h2>
          <ul className="flex flex-col gap-1.5 text-sm text-muted">
            <li>• Pegue 5 projetos seus já mixados por você e passe as pistas no Mix & Master IA.</li>
            <li>• Ouça às cegas (peça para alguém trocar a ordem) a sua mix × a da IA, no mesmo volume.</li>
            <li>• Anote onde a IA perdeu (voz, grave, brilho, espaço) e me mande: é o que ajusto no motor.</li>
          </ul>
        </Card>
      </div>

      <TrainingUpload />
      <TrainingList rows={rows} />
    </div>
  );
}
