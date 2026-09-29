import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/misc";
import { SaveReferral } from "./save-referral";

async function lookup(code: string) {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return null;
  const admin = supabaseAdmin();
  const [{ data: profile }, { data: reward }] = await Promise.all([
    admin.from("profiles").select("referral_code").eq("referral_code", code).maybeSingle(),
    admin.from("system_settings").select("value").eq("key", "referral_reward_referred").maybeSingle(),
  ]);
  return profile ? { reward: Number(reward?.value ?? 10) } : null;
}

export async function generateMetadata(props: PageProps<"/r/[code]">): Promise<Metadata> {
  const { code } = await props.params;
  const info = await lookup(code);
  const reward = info?.reward ?? 10;
  return {
    title: "Você ganhou um convite para o Mix Pro",
    description: `Deixe o som dos seus vídeos com qualidade de estúdio, grátis. Entrando pelo convite você ganha +${reward} créditos na primeira compra.`,
    openGraph: {
      title: `Convite Mix Pro: +${reward} créditos grátis 🎧`,
      description: "Som de estúdio nos seus vídeos em um toque. Grátis e direto no celular.",
    },
    robots: { index: false },
  };
}

export default async function ReferralLandingPage(props: PageProps<"/r/[code]">) {
  const { code } = await props.params;
  const info = await lookup(code);
  if (!info) redirect("/");

  return (
    <div className="safe-top safe-x flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-12">
      <SaveReferral code={code} />
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="glass flex flex-col items-center gap-6 rounded-3xl p-8 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-3xl" aria-hidden>
            🎧
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">
              Um amigo te deu <span className="text-gradient">+{info.reward} créditos</span>
            </h1>
            <p className="mt-2 text-sm text-muted">
              Escolha um vídeo ou áudio, aplique um preset profissional e baixe com som de estúdio. Grátis, direto no
              celular.
            </p>
          </div>
          <ButtonLink href="/estudio" className="w-full" size="lg">
            Começar grátis
          </ButtonLink>
          <p className="text-xs text-subtle">
            Você começa com 5 downloads grátis e ganha +{info.reward} créditos extras na sua primeira compra.
          </p>
        </div>
      </div>
    </div>
  );
}
