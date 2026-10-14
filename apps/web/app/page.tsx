import type { Metadata } from "next";
import Link from "next/link";
import { AudioLines, Clapperboard, Coins, Drum, Gauge, Gift, Lock, Mic2, ShieldCheck, Sliders, SlidersHorizontal, Sparkles, Stethoscope, UserRound, Wand2, Waves } from "lucide-react";
import { parsePremium, type PremiumCatalog, type PremiumId } from "@mixpro/contracts";
import { BusinessFooter } from "@/components/layout/business-footer";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/misc";
import { DemoPlayer } from "@/components/landing/demo-player";
import { ShowcaseStrip } from "@/components/premium/showcase";
import { supabaseAdmin } from "@/lib/supabase/server";
import { SUPPORT_WHATSAPP_PRETTY, supportUrl } from "@/lib/support";

// página estática, refeita a cada hora (preços e dados da empresa vêm do admin)
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Mix Pro — Do celular ao som de estúdio: trate, mixe, produza e separe sua música",
  description:
    "Trate o áudio e o vídeo, mixe e masterize o seu projeto, produza a sua composição a partir da guia e separe voz, bateria, baixo, guitarra, violão e teclado. Prévia grátis antes de pagar.",
  keywords: [
    "mixagem online",
    "masterização online",
    "mixar música com IA",
    "produzir música com IA",
    "playback a partir da guia",
    "separar voz e instrumentos",
    "VS para tocar ao vivo",
    "afinar voz online",
    "melhorar áudio do vídeo",
    "som de estúdio no celular",
  ],
  openGraph: {
    title: "Mix Pro — Do celular ao som de estúdio",
    description: "Trate, mixe, masterize, produza e separe a sua música. Ouça uma prévia grátis antes de pagar.",
    type: "website",
  },
};

async function catalog(): Promise<PremiumCatalog> {
  try {
    const { data } = await supabaseAdmin().from("system_settings").select("value").eq("key", "premium_products").maybeSingle();
    return parsePremium(data?.value);
  } catch {
    return parsePremium(null);
  }
}

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function From({ cat, id }: { cat: PremiumCatalog; id: PremiumId }) {
  const it = cat.items.find((i) => i.id === id);
  if (!it) return null;
  if (!it.enabled) return <span className="rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-semibold text-amber-200">Em breve</span>;
  return it.intro_brl !== null ? (
    <span className="text-sm">
      <span className="text-muted line-through">{brl(it.price_brl)}</span> <strong className="text-emerald-300">{brl(it.intro_brl)}</strong>
      <span className="text-xs text-muted"> na 1ª vez</span>
    </span>
  ) : (
    <strong className="text-sm">{brl(it.price_brl)}</strong>
  );
}

const PATHS = (cat: PremiumCatalog) => [
  {
    href: "/estudio",
    icon: Wand2,
    title: "Melhorar o som de um áudio ou vídeo",
    text: "Voz, violão, guitarra, bateria, podcast ou a música inteira: tira ruído, equaliza, comprime e masteriza no volume certo.",
    send: "Um áudio ou vídeo",
    get: "O mesmo arquivo com som de estúdio",
    price: <span className="text-sm"><strong>Grátis</strong> para testar · R$ 1 por download</span>,
  },
  {
    href: "/mixar",
    icon: Sliders,
    title: "Mixar e masterizar o meu projeto",
    text: "Envie as pistas (voz, bateria, baixo, guitarras, teclados…) e receba a música mixada e masterizada, pronta para o Spotify.",
    send: "As pistas do projeto + uma referência",
    get: "Mix + master, instrumental, a capella, pistas tratadas",
    price: <From cat={cat} id="mix_ia" />,
    dev: true,
  },
  {
    href: "/produzir",
    icon: Mic2,
    title: "Produzir a minha composição",
    text: "Da guia (voz e violão) à música produzida: a IA cria a base no estilo que você quer, você grava a voz e recebe tudo pronto.",
    send: "A guia + uma referência de som",
    get: "3 instrumentais com voz guia, mapa da letra, clique e a música final",
    price: <From cat={cat} id="producao" />,
    dev: true,
  },
  {
    href: "/vs?premium=1",
    icon: AudioLines,
    title: "Criar um VS / separar instrumentos",
    text: "Voz, bateria, baixo, guitarra, violão, teclado e outros em faixas separadas, com clique no andamento — para tocar ao vivo.",
    send: "Uma música",
    get: "Até 7 faixas + clique, mixer e exportação",
    price: <From cat={cat} id="vs_premium" />,
    dev: true,
  },
  {
    href: "/ferramentas",
    icon: Gauge,
    title: "Ferramentas rápidas",
    text: "Mudar o tom e o andamento, juntar voz e playback, masterizar por referência, deixar um álbum consistente e converter formatos.",
    send: "Um ou mais áudios",
    get: "O resultado pronto para baixar",
    price: <span className="text-sm">A partir de <strong>2 créditos</strong></span>,
  },
  {
    href: "/mixagem-profissional",
    icon: UserRound,
    title: "Mixagem feita por um engenheiro",
    text: "Um engenheiro de áudio mixa a sua música à mão, faixa por faixa, conversando com você e com revisões.",
    send: "As pistas (pelo app)",
    get: "Mixagem humana com prazo e revisões",
    price: <span className="text-sm text-muted">Preço na página</span>,
  },
];

const FEATURES = [
  { icon: Wand2, title: "Som de estúdio em 1 clique", text: "Mais de 70 presets de engenheiro: voz, podcast, vocal, instrumentos e masterização." },
  { icon: Drum, title: "Bateria de estúdio", text: "Bateria gravada no celular? O app acha bumbo, caixa e tons e dá o som do estilo." },
  { icon: Waves, title: "Adeus, ruído", text: "Ventilador, ar-condicionado, rua e chiado saem com inteligência artificial." },
  { icon: Stethoscope, title: "Diagnóstico de verdade", text: "Loudness, true peak, ruído, clipping, tom e BPM medidos antes de tratar." },
  { icon: Sparkles, title: "Afinação natural", text: "Corrige o centro de cada nota e mantém o vibrato: a voz não fica robótica." },
  { icon: SlidersHorizontal, title: "Fase e tempo", text: "Alinha os microfones de bateria e as pistas da mesma fonte: nada de som oco." },
  { icon: Gauge, title: "Master para cada destino", text: "Pop americano, Worship, Sertanejo, Funk, Rock… e o volume certo para cada plataforma." },
  { icon: Clapperboard, title: "Vídeo com som novo", text: "Envie o vídeo e baixe o mesmo vídeo, com a imagem intacta e o áudio tratado." },
];

const FAQ: [string, string][] = [
  ["Preciso instalar alguma coisa?", "Não. O Mix Pro funciona no navegador do celular ou do computador — e dá para colocá-lo na tela inicial como um app."],
  ["Eu pago antes de ouvir?", "Não. No Estúdio você ouve o antes e depois de graça, sem limite. Na Produção (Mix & Master IA, composição, VS Premium) você ouve uma prévia grátis de 30 segundos antes de pagar."],
  ["A música continua minha?", "Sim, sempre. Seus arquivos são seus. Na produção com IA, o arranjo é gerado a partir da sua composição — ao distribuir, informe o uso de IA, como as distribuidoras pedem."],
  ["A IA copia a música de referência?", "Não. A referência só orienta o equilíbrio e o estilo. O app confere que o resultado não fica parecido demais com ela, e a referência é apagada depois."],
  ["Meus arquivos ficam guardados?", "No Estúdio, a imagem do vídeo nunca sai do aparelho e o áudio enviado é apagado em até 24 horas. Na Produção, os arquivos ficam no seu Cofre por 30 dias para você baixar e pedir revisões. Nada é usado para treinar IA sem a sua autorização."],
  ["Quanto custa?", "Testar o Estúdio é grátis; cada download custa R$ 1 (ou menos nos planos). Os recursos de Produção têm um preço especial na primeira vez e desconto no Plano Pro."],
  ["Fica pronto para Spotify e YouTube?", "Sim: a entrega sai no volume do estilo (ou da plataforma) com teto de −1 dBTP, em WAV, MP3, M4A — e WAV 24 bits e FLAC no Plano Pro."],
  ["E se eu não gostar do resultado?", "Ajuste no mixer e mande de novo (revisões por 7 dias na Mix & Master IA), ou peça o toque final de um engenheiro."],
  ["Como falo com vocês?", `Pelo WhatsApp ${SUPPORT_WHATSAPP_PRETTY}: tire dúvidas antes de pagar, peça ajuda com o envio ou diga o que não ficou como esperava. Respondemos pessoalmente.`],
];

function PhoneMock() {
  return (
    <div className="relative mx-auto w-64 md:w-72" aria-hidden>
      <div className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(124,58,237,.45),transparent)] blur-2xl" />
      <div className="overflow-hidden rounded-[2.5rem] border-[6px] border-white/10 bg-gradient-to-b from-[#2a1b4f] via-[#171738] to-[#0b0b22] shadow-2xl">
        <div className="flex aspect-[9/19] flex-col gap-3 p-5">
          <div className="flex w-full items-center justify-between text-[10px] text-white/60">
            <span className="rounded-full bg-primary/70 px-2 py-0.5 text-white">Mix & Master IA</span>
            <span>3:42</span>
          </div>
          {["Voz", "Bateria", "Baixo", "Guitarra", "Violão", "Teclado"].map((t, i) => (
            <div key={t} className="flex items-center gap-2 text-[11px] text-white/80">
              <span className="w-14">{t}</span>
              <span className="h-1.5 flex-1 rounded-full bg-white/10">
                <span className="block h-1.5 rounded-full bg-gradient-to-r from-fuchsia-500 to-blue-500" style={{ width: `${[82, 70, 64, 58, 52, 46][i]}%` }} />
              </span>
            </div>
          ))}
          <svg viewBox="0 0 200 40" className="mt-auto h-10 w-full">
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
          <p className="text-center text-[11px] font-semibold text-white">Pronta para o Spotify · −9 LUFS</p>
        </div>
      </div>
    </div>
  );
}

export default async function Landing() {
  const cat = await catalog();
  return (
    <div className="safe-top safe-x flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <Logo />
        <nav className="flex items-center gap-2">
          <span className="hidden sm:block">
            <ButtonLink href="/producao" variant="ghost" size="sm">
              Produção
            </ButtonLink>
          </span>
          <span className="hidden md:block">
            <ButtonLink href="/vs" variant="ghost" size="sm">
              Criar VS
            </ButtonLink>
          </span>
          <ButtonLink href="/estudio" size="sm">
            Abrir o app
          </ButtonLink>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-14 pt-6 md:grid-cols-[1.2fr_1fr] md:px-8 md:pt-14">
          <div className="flex flex-col gap-6">
            <span className="inline-flex items-center gap-2 self-start rounded-full border border-violet-400/30 bg-primary/10 px-3 py-1 text-xs text-violet-200">
              <Sparkles className="size-3.5" /> Prévia grátis antes de pagar · sem instalar nada
            </span>
            <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
              Do celular ao <span className="text-gradient">som de estúdio</span>.
            </h1>
            <p className="max-w-xl text-lg text-muted">
              Trate o áudio e o vídeo, mixe e masterize o seu projeto, produza a sua composição a partir da guia e separe a música em faixas para tocar ao vivo. Tudo
              no navegador, com inteligência artificial e o cuidado de um engenheiro de áudio.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="#o-que-fazer" size="lg">
                O que você quer fazer?
              </ButtonLink>
              <ButtonLink href="/estudio" variant="secondary" size="lg">
                Testar grátis agora
              </ButtonLink>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted">
              <ShieldCheck className="size-4 text-green-400" /> Sua música continua sua. Arquivos apagados automaticamente. Pagamento seguro pelo Mercado Pago.
            </p>
          </div>
          <PhoneMock />
        </section>

        <section id="o-que-fazer" className="mx-auto max-w-6xl scroll-mt-8 px-4 pb-16 md:px-8">
          <h2 className="mb-2 font-display text-2xl font-semibold md:text-3xl">O que você quer fazer?</h2>
          <p className="mb-6 text-muted">Escolha o seu caminho. Em cada um você vê o que envia, o que recebe e quanto custa — e ouve antes de pagar.</p>
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PATHS(cat).map((p) => (
              <li key={p.href}>
                <Link href={p.href} className="glass group flex h-full flex-col gap-3 rounded-3xl p-5 transition hover:border-violet-400/50">
                  <div className="flex items-center gap-3">
                    <span className="bg-brand grid size-11 shrink-0 place-items-center rounded-2xl text-white">
                      <p.icon className="size-5" />
                    </span>
                    <h3 className="font-display text-lg font-semibold leading-tight">{p.title}</h3>
                  </div>
                  {p.dev && <span className="self-start rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200">Novo · em desenvolvimento</span>}
                  <p className="text-sm text-muted">{p.text}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span className="rounded-xl bg-white/5 p-2">
                      <span className="block text-subtle">Você envia</span>
                      {p.send}
                    </span>
                    <span className="rounded-xl bg-white/5 p-2">
                      <span className="block text-subtle">Você recebe</span>
                      {p.get}
                    </span>
                  </div>
                  <div className="mt-auto flex items-center justify-between">
                    {p.price}
                    <span className="text-sm text-violet-200 group-hover:underline">Começar →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-16 md:px-8">
          <h2 className="mb-4 text-center font-display text-2xl font-semibold md:text-3xl">Ouça a diferença</h2>
          <DemoPlayer />
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
          <ShowcaseStrip title="Vitrine: antes e depois de quem já usou" limit={6} />
        </section>

        <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-8 px-4 pb-16 md:px-8">
          <h2 className="mb-8 font-display text-2xl font-semibold md:text-3xl">Como funciona</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              ["Envie", "O áudio, o vídeo, as pistas ou a guia — do celular ou do computador. O app explica exatamente o que mandar."],
              ["Ouça antes de pagar", "O Mix Pro analisa, mostra o diagnóstico e entrega o antes e depois (ou uma prévia de 30 s). Ajuste se quiser."],
              ["Baixe pronto", "No volume certo para Spotify, YouTube e Reels, em WAV, MP3 ou M4A — e o que foi feito em cada passo."],
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

        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
          <h2 className="mb-2 font-display text-2xl font-semibold md:text-3xl">Estúdio tradicional × Mix Pro</h2>
          <p className="mb-6 text-muted">Valores médios de estúdios no Brasil. No Mix Pro, você ouve antes de pagar.</p>
          <div className="overflow-x-auto rounded-3xl border border-border">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr className="border-b border-border">
                  <th className="px-4 py-3 font-normal">Serviço</th>
                  <th className="px-4 py-3 font-normal">Estúdio</th>
                  <th className="px-4 py-3 font-normal">Mix Pro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="px-4 py-3 font-medium">Mixagem + masterização</td>
                  <td className="px-4 py-3 text-muted">R$ 500 a R$ 1.200 · 3 a 7 dias</td>
                  <td className="px-4 py-3">
                    <From cat={cat} id="mix_ia" /> · minutos
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium">Produção da música a partir da guia</td>
                  <td className="px-4 py-3 text-muted">R$ 1.200 a R$ 3.000 · dias</td>
                  <td className="px-4 py-3">
                    <From cat={cat} id="producao" /> · minutos
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium">Multitrack/VS de uma música</td>
                  <td className="px-4 py-3 text-muted">R$ 150 a R$ 200 por música</td>
                  <td className="px-4 py-3">
                    <From cat={cat} id="vs_premium" /> · minutos
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium">Tratar a voz de um vídeo</td>
                  <td className="px-4 py-3 text-muted">Programa caro e tempo de edição</td>
                  <td className="px-4 py-3">
                    <strong>R$ 1</strong> por download (testar é grátis)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8">
          <h2 className="mb-2 font-display text-2xl font-semibold md:text-3xl">Um estúdio inteiro no seu bolso</h2>
          <p className="mb-8 text-muted">O que antes exigia programa caro, equipamento e muito tempo de edição.</p>
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

        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 md:grid-cols-4 md:px-8">
          <div className="glass rounded-3xl p-6">
            <Sparkles className="size-6 text-violet-300" />
            <p className="mt-3 font-display text-2xl font-bold">Grátis para testar</p>
            <p className="text-sm text-muted">Ouça o antes e depois sem limite e ganhe créditos ao criar a conta.</p>
          </div>
          <div className="glass rounded-3xl p-6">
            <Coins className="size-6 text-amber-300" />
            <p className="mt-3 font-display text-2xl font-bold">R$ 1 por download</p>
            <p className="text-sm text-muted">Compre só o que precisar, por PIX ou cartão — ou assine um plano e pague menos.</p>
          </div>
          <div className="glass rounded-3xl p-6">
            <Lock className="size-6 text-emerald-300" />
            <p className="mt-3 font-display text-2xl font-bold">1ª vez com desconto</p>
            <p className="text-sm text-muted">Na Produção, a primeira experiência de cada recurso tem um preço especial.</p>
          </div>
          <div className="glass rounded-3xl p-6">
            <Gift className="size-6 text-pink-300" />
            <p className="mt-3 font-display text-2xl font-bold">Ganhe créditos</p>
            <p className="text-sm text-muted">Indique amigos ou autorize um trecho da sua produção na vitrine.</p>
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
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/estudio" size="lg">
              Testar grátis agora
            </ButtonLink>
            <ButtonLink href="/producao" variant="secondary" size="lg">
              Ver a Produção
            </ButtonLink>
            <ButtonLink href={supportUrl("Olá! Vim pelo site do Mix Pro e tenho uma dúvida.")} variant="ghost" size="lg">
              Tirar dúvidas no WhatsApp
            </ButtonLink>
          </div>
        </section>
      </main>

      <BusinessFooter />
    </div>
  );
}
