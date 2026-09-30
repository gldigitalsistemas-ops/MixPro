import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/misc";
import { SaveReferral } from "@/app/r/[code]/save-referral";

type Shared = { name: string; category_id: string; owner_name: string; referral_code: string | null };

async function lookup(code: string): Promise<(Shared & { category: string }) | null> {
  if (!/^[a-z0-9]{8}$/.test(code)) return null;
  const admin = supabaseAdmin();
  const { data } = await admin.rpc("get_shared_preset", { p_code: code });
  if (!data) return null;
  const s = data as Shared;
  const { data: cat } = await admin.from("preset_categories").select("name").eq("id", s.category_id).maybeSingle();
  return { ...s, category: (cat?.name as string | undefined) ?? "Som" };
}

export async function generateMetadata(props: PageProps<"/p/[code]">): Promise<Metadata> {
  const { code } = await props.params;
  const s = await lookup(code);
  const title = s ? `${s.owner_name} compartilhou o timbre “${s.name}”` : "Preset do Mix Pro";
  return {
    title,
    description: "Abra no Mix Pro e aplique esse som no seu vídeo ou áudio, grátis, direto no celular.",
    openGraph: { title: `🎛️ ${title}`, description: "Ouça esse som no seu vídeo com o Mix Pro — grátis e direto no celular." },
    robots: { index: false },
  };
}

export default async function SharedPresetPage(props: PageProps<"/p/[code]">) {
  const { code } = await props.params;
  const s = await lookup(code);
  if (!s) redirect("/");

  return (
    <div className="safe-top safe-x flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-12">
      {s.referral_code && <SaveReferral code={s.referral_code} />}
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="glass flex flex-col items-center gap-6 rounded-3xl p-8 text-center">
          <span className="bg-brand grid size-16 place-items-center rounded-2xl text-white" aria-hidden>
            <SlidersHorizontal className="size-8" />
          </span>
          <div>
            <p className="text-xs uppercase tracking-wider text-violet-300">{s.category}</p>
            <h1 className="mt-1 font-display text-2xl font-bold">“{s.name}”</h1>
            <p className="mt-2 text-sm text-muted">
              {s.owner_name} montou esse som no Mix Pro e compartilhou com você. Escolha um vídeo ou áudio seu, ouça o antes e depois e
              ajuste do seu jeito. Grátis, direto no celular.
            </p>
          </div>
          <ButtonLink href={`/estudio?preset=${code}`} className="w-full" size="lg">
            Usar esse som
          </ButtonLink>
          <p className="text-xs text-subtle">Você começa com downloads grátis ao criar a conta.</p>
        </div>
      </div>
    </div>
  );
}
