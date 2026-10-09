import type { Metadata } from "next";
import { BusinessFooter } from "@/components/layout/business-footer";
import { AudioLines, Clapperboard, Coins, Drum, Gauge, Gift, Mic2, ShieldCheck, SlidersHorizontal, Sparkles, Stethoscope, Wand2, Waves } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/misc";
import { DemoPlayer } from "@/components/landing/demo-player";

// página estática, refeita a cada hora (o rodapé lê os dados da empresa do admin)
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Mix Pro — Mixagem e masterização online para a sua gravação",
  description:
    "Grave no celular, no microfone ou na interface e deixe o Mix Pro tratar, mixar e masterizar: voz, violão, guitarra, baixo, bateria e música completa. Diagnóstico técnico, antes e depois e volume certo para Spotify, YouTube e Reels.",
  keywords: [
    "melhorar áudio do vídeo",
    "masterizar música online",
    "remover ruído do vídeo",
    "voz de podcast",
    "melhorar som da gravação do celular",
    "mixagem online",
    "masterização online",
    "som de bateria de estúdio",
    "bateria gravada no celular",
  ],
  openGraph: {
    title: "Mix Pro — Você grava. O Mix Pro transforma o áudio.",
    description: "Tratamento, mixagem e masterização para voz, instrumentos e músicas. Grátis para começar.",
    type: "website",
  },
};

const FEATURES = [
  { icon: Wand2, title: "Som de estúdio", text: "Mais de 70 presets feitos por engenheiro de áudio: voz de criador, podcast, vocal, rap, instrumentos e masterização." },
  { icon: Drum, title: "Bateria de estúdio", text: "Gravou a bateria no celular? O app acha bumbo, caixa e tons e dá o som de estúdio: worship, pop rock, reggae, groove, soul e mais." },
  { icon: Waves, title: "Adeus, ruído", text: "Tira ventilador, ar-condicionado, rua e chiado com inteligência artificial." },
  { icon: Stethoscope, title: "Diagnóstico do áudio", text: "Loudness, true peak, ruído, clipping, graves e agudos medidos de verdade, antes de tratar." },
  { icon: Gauge, title: "Masterização no volume certo", text: "Natural, Podcast, Redes e streaming ou Alto: o volume ideal para cada destino, sem estourar." },
  { icon: Clapperboard, title: "Vídeo com som novo", text: "Envie o vídeo e baixe o mesmo vídeo, com a imagem intacta e o áudio tratado." },
  { icon: AudioLines, title: "Violão, guitarra, baixo e teclado", text: "Gravou no celular ou plugou no cabo? Presets para cada jeito de gravar, com amplificadores e 10 caixas de estúdio." },
  { icon: SlidersHorizontal, title: "Separe a sua música", text: "Voz, bateria, baixo e instrumentos em faixas separadas para ensaio, playback e remix." },
];

const FAQ = [
  ["Preciso instalar alguma coisa?", "Não. O Mix Pro funciona no navegador do celular ou do computador. Se quiser, dá para adicioná-lo à tela inicial como um app."],
  ["Meu arquivo fica guardado?", "A imagem do vídeo nunca sai do seu aparelho. Para tratar, enviamos só o áudio, que é apagado automaticamente em até 24 horas e nunca é usado para treinar inteligência artificial."],
  ["Quanto custa?", "Testar e ouvir é grátis e ilimitado. Você ganha 5 downloads ao criar a conta; depois, cada download custa R$ 1,00 e você compra só o que precisar, por PIX ou cartão. Quem posta muito pode assinar o Plano Criador, com créditos todo mês por um preço menor."],
  ["Funciona com bateria gravada no celular?", "Sim. Na categoria Bateria de Estúdio o app identifica bumbo, caixa, tons e pratos e reforça cada batida com o timbre do estilo escolhido. Você ajusta o volume de cada peça e ouve na hora."],
  ["Em quais formatos eu baixo?", "MP3, WAV e M4A. Em vídeo, você baixa o mesmo vídeo com o som novo ou só o áudio tratado."],
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
              Você grava. O Mix Pro <span className="text-gradient">transforma o áudio</span>.
            </h1>
            <p className="max-w-xl text-lg text-muted">
              Voz, violão, guitarra, baixo, bateria ou a música inteira: envie a gravação do celular, do microfone ou da interface e
              baixe mixada e masterizada, no volume certo para Spotify, YouTube e Reels.
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
              <ShieldCheck className="size-4 text-green-400" /> O áudio enviado é apagado em até 24 horas. A imagem do vídeo nunca sai do aparelho.
            </p>
          </div>
          <PhoneMock />
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-16 md:px-8">
          <DemoPlayer />
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
          <h2 className="mb-2 font-display text-2xl font-semibold md:text-3xl">Um estúdio inteiro para a sua gravação</h2>
          <p className="mb-8 text-muted">Ferramentas de estúdio que antes exigiam programa caro e muito tempo de edição.</p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              ["Envie a gravação", "Áudio (MP3, WAV, M4A, FLAC) ou vídeo (MP4, MOV), do celular ou do computador."],
              ["Ouça o antes e depois", "O Mix Pro analisa, mostra o diagnóstico e escolhe o tratamento. Ajuste se quiser."],
              ["Baixe pronto", "Áudio mixado e masterizado, ou o mesmo vídeo com o som novo."],
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
            <p className="text-sm text-muted">Compre só o que precisar, por PIX ou cartão. Posta toda semana? O Plano Criador sai mais barato.</p>
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

      <BusinessFooter />
    </div>
  );
}
