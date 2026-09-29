import type { Metadata } from "next";
import Link from "next/link";
import {
  AudioLines,
  Captions,
  Coins,
  Gift,
  Mic2,
  RectangleVertical,
  Scissors,
  ShieldCheck,
  Sparkles,
  Wand2,
  Waves,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/misc";
import { DemoPlayer } from "@/components/landing/demo-player";

export const metadata: Metadata = {
  title: "Mix Pro — Som de estúdio e legendas nos seus vídeos",
  description:
    "Melhore o áudio dos seus vídeos para Reels, TikTok e YouTube: presets profissionais, remoção de ruído, legendas automáticas, cortes de silêncio e formato vertical. Direto no celular, sem enviar seu arquivo.",
  keywords: [
    "melhorar áudio do vídeo",
    "legenda automática reels",
    "remover ruído do vídeo",
    "voz de podcast",
    "cortar silêncio do vídeo",
    "mixagem online",
    "masterização online",
  ],
  openGraph: {
    title: "Mix Pro — Som de estúdio e legendas nos seus vídeos",
    description: "Presets profissionais, legendas automáticas e cortes de silêncio. Grátis para começar, direto no celular.",
    type: "website",
  },
};

const FEATURES = [
  { icon: Wand2, title: "Som de estúdio", text: "44 presets feitos por engenheiro de áudio: voz de podcast, vocal, rap, instrumentos e masterização." },
  { icon: Waves, title: "Adeus, ruído", text: "Tira ventilador, ar-condicionado, rua e chiado com inteligência artificial." },
  { icon: Captions, title: "Legendas automáticas", text: "A IA escreve o que você fala, palavra por palavra, no estilo dos Reels e TikTok." },
  { icon: Scissors, title: "Corte de silêncios", text: "Remove pausas e “é…”, “hã…” automaticamente. Vídeo mais dinâmico, sem editar." },
  { icon: RectangleVertical, title: "Formato vertical", text: "Transforma vídeo deitado em 9:16 com fundo desfocado, pronto para o feed." },
  { icon: AudioLines, title: "Audiograma", text: "Transforma podcast ou música em vídeo com onda animada e legendas." },
];

const FAQ = [
  ["Preciso instalar alguma coisa?", "Não. O Mix Pro funciona no navegador do celular ou do computador. Se quiser, dá para adicioná-lo à tela inicial como um app."],
  ["Meu vídeo é enviado para algum servidor?", "Não. Todo o processamento acontece no seu aparelho. Seu arquivo nunca sai dele."],
  ["Quanto custa?", "Testar e ouvir é grátis e ilimitado. Você ganha 5 downloads ao criar a conta; depois, cada download custa R$ 1,00 e você compra só o que precisar, por PIX ou cartão."],
  ["Posso usar o áudio no CapCut?", "Sim. Além do vídeo pronto, você pode baixar só o áudio (MP3, WAV ou M4A) e as legendas em .srt."],
  ["E se eu quiser uma mixagem feita por um profissional?", "Na Mixagem Profissional um engenheiro de áudio mixa a sua música à mão, com revisões inclusas."],
];

function PhoneMock() {
  return (
    <div className="relative mx-auto w-64 md:w-72" aria-hidden>
      <div className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(124,58,237,.45),transparent)] blur-2xl" />
      <div className="overflow-hidden rounded-[2.5rem] border-[6px] border-white/10 bg-gradient-to-b from-[#2a1b4f] via-[#171738] to-[#0b0b22] shadow-2xl">
        <div className="flex aspect-[9/19] flex-col items-center justify-between p-5">
          <div className="flex w-full items-center justify-between text-[10px] text-white/60">
            <span className="rounded-full bg-primary/70 px-2 py-0.5 text-white">Com Mix Pro</span>
            <span>0:12</span>
          </div>
          <div className="grid size-24 place-items-center rounded-full bg-white/10 text-4xl">🎙️</div>
          <div className="w-full text-center">
            <p className="font-[family-name:var(--font-caption)] text-2xl font-black uppercase leading-tight tracking-tight [-webkit-text-stroke:5px_#000] [paint-order:stroke_fill]">
              <span className="text-white">Som de </span>
              <span className="text-[#ffe500]">estúdio</span>
            </p>
            <svg viewBox="0 0 200 40" className="mt-4 h-10 w-full">
              <defs>
                <linearGradient id="lp-g" x1="0" x2="1">
                  <stop offset="0" stopColor="#d946ef" />
                  <stop offset="1" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
              {Array.from({ length: 50 }, (_, i) => {
                const h = 6 + Math.abs(Math.sin(i * 0.55) * 22 + Math.sin(i * 1.3) * 8);
                return <rect key={i} x={i * 4} y={20 - h / 2} width="2.4" height={h} rx="1.2" fill="url(#lp-g)" />;
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="safe-top safe-x flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <Logo />
        <nav className="flex items-center gap-2">
          <span className="hidden sm:block">
            <ButtonLink href="/mixagem-profissional" variant="ghost" size="sm">
              Mixagem profissional
            </ButtonLink>
          </span>
          <ButtonLink href="/estudio" size="sm">
            Abrir estúdio
          </ButtonLink>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-6 md:grid-cols-[1.2fr_1fr] md:px-8 md:pt-14">
          <div className="flex flex-col gap-6">
            <span className="inline-flex items-center gap-2 self-start rounded-full border border-violet-400/30 bg-primary/10 px-3 py-1 text-xs text-violet-200">
              <Sparkles className="size-3.5" /> 5 downloads grátis · sem instalar nada
            </span>
            <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
              Seu vídeo com <span className="text-gradient">som de estúdio</span> e legendas, em 1 minuto.
            </h1>
            <p className="max-w-xl text-lg text-muted">
              Escolha o vídeo da galeria, toque num preset, gere as legendas e baixe pronto para o Reels, TikTok ou YouTube.
              Tudo no seu celular.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/estudio" size="lg">
                Começar grátis
              </ButtonLink>
              <ButtonLink href="#como-funciona" variant="secondary" size="lg">
                Como funciona
              </ButtonLink>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted">
              <ShieldCheck className="size-4 text-green-400" /> Seu arquivo é processado no seu aparelho e nunca é enviado.
            </p>
          </div>
          <PhoneMock />
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-16 md:px-8">
          <DemoPlayer />
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
          <h2 className="mb-2 font-display text-2xl font-semibold md:text-3xl">Tudo o que o seu vídeo precisa</h2>
          <p className="mb-8 text-muted">Ferramentas de estúdio que antes exigiam programa caro e muito tempo de edição.</p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="glass rounded-3xl p-5">
                <span className="bg-brand mb-4 grid size-11 place-items-center rounded-2xl text-white">
                  <Icon className="size-5" />
                </span>
                <h3 className="font-display text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-8 px-4 pb-16 md:px-8">
          <h2 className="mb-8 font-display text-2xl font-semibold md:text-3xl">Como funciona</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              ["Escolha o vídeo", "Direto da galeria do celular. Também funciona com áudio (MP3, WAV, M4A)."],
              ["Ajuste em poucos toques", "Preset de som, remoção de ruído, legendas, cortes e formato. Ouça o antes e depois na hora."],
              ["Baixe e poste", "Vídeo pronto para postar, ou só o áudio e a legenda para usar no CapCut."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4 rounded-3xl border border-border p-5">
                <span className="font-display text-4xl font-bold text-violet-400/60">{i + 1}</span>
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="text-sm text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 md:grid-cols-3 md:px-8">
          <div className="glass rounded-3xl p-6">
            <Sparkles className="size-6 text-violet-300" />
            <p className="mt-3 font-display text-3xl font-bold">Grátis</p>
            <p className="text-sm text-muted">para testar tudo, sem limite, e 5 downloads ao criar a conta.</p>
          </div>
          <div className="glass rounded-3xl p-6">
            <Coins className="size-6 text-amber-300" />
            <p className="mt-3 font-display text-3xl font-bold">R$ 1 por download</p>
            <p className="text-sm text-muted">Compre só o que precisar, por PIX ou cartão. Sem assinatura.</p>
          </div>
          <div className="glass rounded-3xl p-6">
            <Gift className="size-6 text-pink-300" />
            <p className="mt-3 font-display text-3xl font-bold">+10 créditos</p>
            <p className="text-sm text-muted">para você e para cada amigo que você indicar, na primeira compra dele.</p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
          <div className="glass flex flex-col items-start gap-4 rounded-3xl p-6 md:flex-row md:items-center md:p-8">
            <span className="bg-brand grid size-14 shrink-0 place-items-center rounded-2xl text-white">
              <Mic2 className="size-7" />
            </span>
            <div className="flex-1">
              <h2 className="font-display text-xl font-semibold md:text-2xl">Gravou uma música? Deixe com um profissional.</h2>
              <p className="text-sm text-muted">
                Na Mixagem Profissional um engenheiro de áudio mixa as suas faixas à mão, com revisões inclusas.
              </p>
            </div>
            <ButtonLink href="/mixagem-profissional" variant="secondary">
              Conhecer
            </ButtonLink>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-20 md:px-8">
          <h2 className="mb-6 font-display text-2xl font-semibold md:text-3xl">Perguntas frequentes</h2>
          <div className="flex flex-col gap-2">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group rounded-2xl border border-border p-4">
                <summary className="cursor-pointer list-none font-medium">{q}</summary>
                <p className="mt-2 text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
          <div className="mt-10 text-center">
            <ButtonLink href="/estudio" size="lg">
              Começar grátis
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-6 text-center text-xs text-subtle">
        Mix Pro · <Link href="/termos" className="hover:text-text">Termos</Link> ·{" "}
        <Link href="/privacidade" className="hover:text-text">Privacidade</Link>
      </footer>
    </div>
  );
}
