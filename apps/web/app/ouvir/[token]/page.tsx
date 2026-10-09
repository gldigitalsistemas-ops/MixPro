import type { Metadata } from "next";
import { AudioLines } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/misc";
import { SaveReferral } from "@/app/r/[code]/save-referral";
import { openShare } from "@/lib/share/server";
import { shareDeps } from "@/lib/share/deps";
import { BeforeAfterPlayer } from "./player";

// cada visita assina URLs novas (valem 1 h) e conta a visualização
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ouça o antes e depois",
  description: "Áudio tratado no Mix Pro: compare o antes e o depois.",
  openGraph: { title: "🎧 Ouça o antes e depois", description: "Áudio tratado no Mix Pro. Toque e compare." },
  robots: { index: false },
};

export default async function SharePage(props: PageProps<"/ouvir/[token]">) {
  const { token } = await props.params;
  const deps = shareDeps();
  const page = deps ? await openShare(deps, token) : null;

  return (
    <div className="safe-top safe-x flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-12">
      {page?.referralCode && <SaveReferral code={page.referralCode} />}
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="glass flex flex-col items-center gap-6 rounded-3xl p-8 text-center">
          <span className="bg-brand grid size-16 place-items-center rounded-2xl text-white" aria-hidden>
            <AudioLines className="size-8" />
          </span>
          {page ? (
            <>
              <div>
                <h1 className="font-display text-2xl font-bold">{page.title || "Antes e depois"}</h1>
                <p className="mt-2 text-sm text-muted">
                  Tratado no Mix Pro{page.preset ? ` com o som “${page.preset}”` : ""}. Toque e alterne para ouvir a diferença.
                </p>
              </div>
              <BeforeAfterPlayer before={page.before} after={page.after} lufsBefore={page.lufsBefore} lufsAfter={page.lufsAfter} />
            </>
          ) : (
            <div>
              <h1 className="font-display text-2xl font-bold">Este link expirou</h1>
              <p className="mt-2 text-sm text-muted">Os links de antes e depois valem 24 horas. Trate o seu próprio áudio e compare você mesmo.</p>
            </div>
          )}
          <ButtonLink href="/estudio" className="w-full" size="lg">
            Tratar o meu áudio grátis
          </ButtonLink>
          <p className="text-xs text-subtle">Você grava. O Mix Pro transforma o áudio. Direto no celular.</p>
        </div>
      </div>
    </div>
  );
}
