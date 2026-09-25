import { requireSession, supabaseServer } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { CopyLinkButton } from "./copy-link-button";

export const metadata = { title: "Indicações" };

export default async function IndicacoesPage() {
  await requireSession("/app/indicacoes");
  const supabase = await supabaseServer();

  const { data: stats } = await supabase.rpc("my_referral_stats");
  const s = (stats ?? {}) as {
    code: string;
    total_referred: number;
    qualified: number;
    credits_earned: number;
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const link = `${appUrl}/r/${s.code}`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Indicações</h1>
        <p className="mt-1 text-sm text-muted">
          Indique amigos e ganhe créditos quando eles fizerem o primeiro download.
        </p>
      </div>

      <Card className="flex flex-col gap-5 p-6">
        <div>
          <p className="text-sm font-medium">Seu link de indicação</p>
          <p className="mt-0.5 text-xs text-muted">Compartilhe este link para convidar amigos.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-black/20 px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-sm font-mono text-muted">{link}</span>
          <CopyLinkButton link={link} />
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-white/4 p-4">
            <p className="font-display text-3xl font-bold tabular-nums">{s.total_referred ?? 0}</p>
            <p className="mt-1 text-xs text-muted">Cadastros</p>
          </div>
          <div className="rounded-xl bg-white/4 p-4">
            <p className="font-display text-3xl font-bold tabular-nums">{s.qualified ?? 0}</p>
            <p className="mt-1 text-xs text-muted">Qualificados</p>
          </div>
          <div className="rounded-xl bg-white/4 p-4">
            <p className="font-display text-3xl font-bold tabular-nums text-green-300">{s.credits_earned ?? 0}</p>
            <p className="mt-1 text-xs text-muted">Créditos ganhos</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="font-medium">Como funciona</h2>
        <ol className="mt-3 flex flex-col gap-3 text-sm text-muted">
          <li className="flex gap-3">
            <span className="bg-brand flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">1</span>
            <span>Compartilhe seu link. Quem se cadastrar por ele recebe <strong className="text-text">+5 downloads</strong> de boas-vindas.</span>
          </li>
          <li className="flex gap-3">
            <span className="bg-brand flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">2</span>
            <span>Quando seu indicado fizer o primeiro download pago, a indicação <strong className="text-text">qualifica</strong>.</span>
          </li>
          <li className="flex gap-3">
            <span className="bg-brand flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">3</span>
            <span>Vocês dois ganham <strong className="text-text">+10 downloads</strong> automaticamente. Sem limite de indicações.</span>
          </li>
        </ol>
      </Card>
    </div>
  );
}
