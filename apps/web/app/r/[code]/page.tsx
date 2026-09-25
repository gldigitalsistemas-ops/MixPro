import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/misc";

export async function generateMetadata(props: PageProps<"/r/[code]">): Promise<Metadata> {
  const { code } = await props.params;
  const { data } = await supabaseAdmin().from("profiles").select("display_name").eq("referral_code", code).maybeSingle();
  const name = data?.display_name ?? "um amigo";
  return {
    title: `${name} te convidou para o Mix Pro`,
    description: `Ganhe 5 downloads gratuitos e mais 10 ao fazer seu primeiro download. Crie sua conta agora.`,
    openGraph: {
      title: `${name} te convidou para o Mix Pro 🎧`,
      description: "Mixagem de áudio profissional online. Teste presets, compare A/B e baixe seu resultado.",
    },
  };
}

export default async function ReferralLandingPage(props: PageProps<"/r/[code]">) {
  const { code } = await props.params;

  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("display_name, referral_code")
    .eq("referral_code", code)
    .maybeSingle();

  if (!profile) redirect("/cadastro");

  const name = profile.display_name ?? "Um amigo";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="glass flex flex-col items-center gap-6 rounded-3xl p-8 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/15 text-3xl">
            🎧
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">
              <span className="text-gradient">{name}</span> te convidou!
            </h1>
            <p className="mt-2 text-sm text-muted">
              Crie sua conta no Mix Pro e ganhe créditos bônus para testar presets profissionais de áudio.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 rounded-2xl bg-white/5 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Bônus de boas-vindas</span>
              <span className="font-semibold text-green-300">+5 downloads</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Bônus de indicação</span>
              <span className="font-semibold text-green-300">+10 downloads</span>
            </div>
            <div className="mt-1 border-t border-white/8 pt-2 flex items-center justify-between font-semibold">
              <span>Total ao entrar</span>
              <span className="text-gradient text-lg">15 downloads</span>
            </div>
          </div>

          <ButtonLink
            href={`/cadastro?ref=${code}`}
            className="w-full"
            size="lg"
          >
            Criar conta grátis
          </ButtonLink>

          <p className="text-xs text-subtle">
            O bônus de indicação (+10) é creditado após seu primeiro download pago.
          </p>
        </div>
      </div>
    </div>
  );
}
