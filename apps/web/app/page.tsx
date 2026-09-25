import Link from "next/link";
import { ArrowRight, AudioLines, CloudUpload, Download, GitCompareArrows, SlidersHorizontal, UserRound } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/misc";
import { getSession } from "@/lib/supabase/server";

export const metadata = {
  title: "Mix Pro — Mixagem e masterização online por presets",
  description:
    "Mixagem online de voz, bateria e instrumentos e masterização de música com presets profissionais. Envie seu áudio, compare antes e depois e baixe. 5 downloads grátis.",
  keywords: ["mixagem online", "masterização online", "mixagem de voz", "masterização de música", "melhorar áudio", "mixar música online", "presets de mixagem"],
};

const STEPS = [
  { icon: CloudUpload, title: "Envie seu áudio", text: "WAV, MP3, FLAC ou AIFF — do computador ou do celular." },
  { icon: SlidersHorizontal, title: "Escolha uma sonoridade", text: "Quente, brilhante, com punch, moderna… sem termos técnicos." },
  { icon: GitCompareArrows, title: "Compare", text: "Alterne entre original e processado no mesmo ponto da música." },
  { icon: Download, title: "Baixe", text: "Gostou? Baixe em WAV ou MP3. Testar é ilimitado." },
];

function DemoWave({ seed, bright }: { seed: number; bright?: boolean }) {
  const bars = Array.from({ length: 72 }, (_, i) => {
    const x = Math.sin(i * 0.37 + seed) * 0.5 + Math.sin(i * 0.11 + seed * 2) * 0.35 + Math.sin(i * 1.7) * 0.15;
    return Math.abs(x) * (bright ? 1 : 0.55) + 0.08;
  });
  return (
    <svg viewBox="0 0 216 60" className="h-16 w-full" aria-hidden preserveAspectRatio="none">
      {bars.map((h, i) => (
        <rect key={i} x={i * 3} y={30 - h * 28} width="2" height={h * 56} rx="1" fill={bright ? "url(#lg)" : "#6f6f98"} />
      ))}
      <defs>
        <linearGradient id="lg" x1="0" x2="1">
          <stop offset="0" stopColor="#d946ef" />
          <stop offset="0.5" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default async function Landing() {
  const session = await getSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <Logo />
        <nav className="flex items-center gap-2">
          {session ? (
            <ButtonLink href="/app" size="sm">
              Abrir o app
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/entrar" variant="ghost" size="sm">
                Entrar
              </ButtonLink>
              <ButtonLink href="/cadastro" size="sm">
                Testar grátis
              </ButtonLink>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 md:grid-cols-2 md:px-8 md:pt-16">
          <div className="flex flex-col gap-6">
            <Badge tone="primary" className="self-start">
              5 downloads grátis para começar
            </Badge>
            <h1 className="font-display text-4xl font-bold leading-tight tracking-tight md:text-5xl">
              Transforme suas gravações em <span className="text-gradient">novas possibilidades de som.</span>
            </h1>
            <p className="max-w-lg text-lg text-muted">
              Envie seu áudio, experimente diferentes sonoridades e escolha a mix que mais combina com a sua música.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={session ? "/app/novo" : "/cadastro"} size="lg">
                Testar grátis <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="#como-funciona" variant="secondary" size="lg">
                Como funciona
              </ButtonLink>
            </div>
            <p className="text-sm text-subtle">Você cria o som. Nós ajudamos a encontrar a sonoridade.</p>
          </div>

          <Card className="flex flex-col gap-4 p-5" aria-label="Ilustração da comparação antes e depois">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Compare e escolha o seu som</span>
              <span className="text-subtle">ilustração</span>
            </div>
            <div className="rounded-2xl bg-black/25 p-3">
              <p className="mb-1 text-xs text-blue-300">A · Original</p>
              <DemoWave seed={1} />
            </div>
            <div className="rounded-2xl border border-violet-400/30 bg-primary/10 p-3">
              <p className="mb-1 text-xs text-violet-300">B · Vocal Presence · 75%</p>
              <DemoWave seed={1} bright />
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-2xl border border-border-strong p-1 text-center text-xs">
              {["25%", "50%", "75%", "100%"].map((i) => (
                <span key={i} className={i === "75%" ? "bg-brand rounded-xl py-2 text-white" : "py-2 text-muted"}>
                  {i}
                </span>
              ))}
            </div>
          </Card>
        </section>

        <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <h2 className="text-center font-display text-3xl font-semibold">Simples assim</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title}>
                <Card className="h-full p-5">
                  <div className="flex items-center gap-3">
                    <span className="bg-brand grid size-9 place-items-center rounded-full text-sm font-semibold">{i + 1}</span>
                    <Icon className="size-5 text-violet-300" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-medium">{title}</h3>
                  <p className="mt-1 text-sm text-muted">{text}</p>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-4 py-16 md:grid-cols-2 md:px-8">
          <Card className="p-6">
            <SlidersHorizontal className="size-7 text-violet-300" aria-hidden />
            <h2 className="mt-4 font-display text-2xl font-semibold">Quero fazer sozinho</h2>
            <p className="mt-2 text-muted">
              Presets profissionais para voz, bateria, baixo, guitarra, violão e master. Rápido, acessível e você escolhe.
            </p>
            <ButtonLink href={session ? "/app/novo" : "/cadastro"} className="mt-5">
              Começar
            </ButtonLink>
          </Card>
          <Card className="p-6">
            <UserRound className="size-7 text-fuchsia-300" aria-hidden />
            <h2 className="mt-4 flex items-center gap-2 font-display text-2xl font-semibold">
              Quero que você faça <Badge>Em breve</Badge>
            </h2>
            <p className="mt-2 text-muted">
              Mixagem personalizada por um engenheiro de áudio: análise individual, ajustes específicos e revisão incluída.
            </p>
          </Card>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-16 text-center md:px-8">
          <AudioLines className="mx-auto size-8 text-violet-300" aria-hidden />
          <h2 className="mt-4 font-display text-2xl font-semibold">Sem promessas mágicas</h2>
          <p className="mt-3 text-muted">
            A qualidade do resultado depende da gravação original. O Mix Pro não é uma IA que “faz qualquer música ficar profissional”:
            é uma biblioteca de cadeias de processamento criadas por um engenheiro de áudio, que você aplica e compara no seu próprio
            áudio — sem precisar dominar os detalhes técnicos.
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-subtle md:px-8">
          <Logo compact />
          <nav className="flex gap-4">
            <Link href="/termos" className="hover:text-text">
              Termos
            </Link>
            <Link href="/privacidade" className="hover:text-text">
              Privacidade
            </Link>
          </nav>
          <span>© {new Date().getFullYear()} Mix Pro</span>
        </div>
      </footer>
    </div>
  );
}
