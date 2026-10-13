import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { SUPPORT_WHATSAPP_PRETTY, supportUrl } from "@/lib/support";

export const metadata = { title: "Ajuda", description: "Como exportar as pistas do seu projeto, o que enviar em cada recurso e como falar com a gente." };
export const revalidate = 3600;

const DAWS: { id: string; name: string; steps: string[] }[] = [
  {
    id: "fl-studio",
    name: "FL Studio",
    steps: [
      "Abra o projeto e deixe os volumes dos canais como estão no seu mix (a IA parte deles). Tire o limiter e os efeitos do Master.",
      "Menu File → Export → WAV file.",
      "Em “Mode”, escolha Split mixer tracks (cada faixa do Mixer vira um arquivo). Para canais soltos, use Split by channel.",
      "Resolução: 24 bits. Marque “Render at” 48 kHz (ou a taxa do projeto). Deixe o Master em “Disable”.",
      "Em “Start/End”, deixe do compasso 1 até o fim, para todas as pistas começarem no mesmo ponto.",
      "Clique em Start, depois selecione todos os WAV da pasta e envie no Mix Pro.",
    ],
  },
  {
    id: "reaper",
    name: "Reaper",
    steps: [
      "Selecione todas as faixas (Ctrl+A na lista de faixas) e tire o limiter do Master.",
      "File → Render. Em “Source”, escolha Selected tracks (via master mix → mude para Stems (selected tracks)).",
      "“Bounds”: Entire project (todas começam no mesmo ponto).",
      "Formato WAV, 24 bits, taxa do projeto. Em “Options”, marque “Tracks with only mono media to mono files”.",
      "Render. Os arquivos saem um por faixa, prontos para enviar.",
    ],
  },
  {
    id: "studio-one",
    name: "Studio One",
    steps: [
      "Song → Export Stems… (selecione todas as faixas e marque “Include Master Bus Effects”: desmarque).",
      "Formato WAV, 24 bits, taxa do projeto.",
      "Em “Export Range”, deixe do início ao fim da música.",
      "Marque “Disable Master” se existir e exporte. Envie a pasta com os arquivos no Mix Pro.",
    ],
  },
  {
    id: "cubase",
    name: "Cubase",
    steps: [
      "Selecione os canais no MixConsole e deixe o Stereo Out sem limiter.",
      "File → Export → Audio Mixdown.",
      "“Channel Selection”: marque todas as faixas de áudio e de instrumentos (um arquivo por canal).",
      "Formato WAV, 24 bits, taxa do projeto. Os locators devem cobrir do início ao fim.",
      "Desmarque “Import into pool/project” se não precisar e clique em Export Audio.",
    ],
  },
  {
    id: "celular",
    name: "Celular (BandLab, GarageBand, Cakewalk…)",
    steps: [
      "BandLab: abra o projeto, toque nas três linhas → Export → “Export tracks as WAV”. Salve em Arquivos.",
      "GarageBand (iPhone/iPad): na tela de faixas, toque em Compartilhar → Projeto no Arquivos. Para trilhas individuais, use o GarageBand no Mac (Compartilhar → Exportar faixas como arquivos de áudio).",
      "Qualquer outro app: procure “exportar stems” ou “exportar faixas separadas”. Se só houver o áudio final, use o recurso “Estúdio” do Mix Pro.",
      "No Mix Pro, escolha todos os arquivos de uma vez na tela de envio.",
    ],
  },
];

const RECEIVES = [
  ["Mix & Master IA", "Pistas dos instrumentos e da voz (WAV, AIFF, FLAC, MP3 ou M4A), todas começando no mesmo ponto, até 24 pistas e 6 minutos. Opcional: uma música de referência."],
  ["Produza sua composição", "A guia da sua música: só a voz, voz e violão ou uma guia com banda (áudio ou vídeo, até 6 minutos). Opcional: referência e letra."],
  ["Voz finalizada", "A sua voz gravada (no app ou do estúdio) e a base escolhida. O app alinha sozinho (até 3 segundos de diferença)."],
  ["VS Premium (em breve)", "Uma música (áudio ou vídeo, até 6 minutos; até 10 com valor proporcional)."],
];

export default function Help() {
  return (
    <>
      <h1>Ajuda</h1>
      <p>Aqui você vê como preparar os arquivos, o que enviar em cada recurso e como falar com a gente.</p>

      <a
        href={supportUrl("Olá! Preciso de ajuda no Mix Pro.")}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-emerald-100 hover:bg-emerald-400/15"
      >
        <MessageCircle className="size-6 shrink-0" aria-hidden />
        <span>
          <strong className="block text-base">Chame no WhatsApp: {SUPPORT_WHATSAPP_PRETTY}</strong>
          <span className="text-sm">Dúvidas antes de pagar, ajuda com o envio ou algo que não ficou como você esperava: a gente responde e refaz.</span>
        </span>
      </a>

      <h2>O que enviar em cada recurso</h2>
      <ul className="list-disc pl-5">
        {RECEIVES.map(([t, d]) => (
          <li key={t}>
            <strong className="text-text">{t}:</strong> {d}
          </li>
        ))}
      </ul>

      <h2>Como exportar as pistas do seu projeto</h2>
      <p>
        Regras para todos os programas: cada instrumento em um arquivo; <strong className="text-text">todos começando no mesmo ponto</strong> (do início da música);
        sem limiter nem masterização no Master; WAV de 24 bits na taxa do projeto. Pistas mono podem ficar mono.
      </p>
      <nav aria-label="Programas" className="flex flex-wrap gap-2">
        {DAWS.map((d) => (
          <a key={d.id} href={`#${d.id}`} className="rounded-full border border-border-strong px-3 py-1 text-xs text-text hover:bg-white/5">
            {d.name}
          </a>
        ))}
      </nav>
      {DAWS.map((d) => (
        <section key={d.id} id={d.id} className="scroll-mt-6">
          <h2>{d.name}</h2>
          <ol className="list-decimal pl-5">
            {d.steps.map((s) => (
              <li key={s} className="mt-1">
                {s}
              </li>
            ))}
          </ol>
        </section>
      ))}

      <h2>Dicas para um resultado melhor</h2>
      <ul className="list-disc pl-5">
        <li>Dê nomes claros às pistas (“Voz principal”, “Bumbo”, “Baixo DI”, “Violão”…): o app reconhece o instrumento pelo nome, e você confere na tela.</li>
        <li>Não coloque efeitos de master nem normalização nas pistas. A IA decide o nível de cada uma.</li>
        <li>Se tiver duas ou mais pistas da mesma fonte (microfone de perto e de ambiente, baixo DI e amplificador), envie todas: o app alinha a fase.</li>
        <li>Na Produção da composição, grave a guia com o violão e a voz o mais limpos possível. Quanto mais clara a harmonia, melhor a base.</li>
        <li>A prévia grátis de 30 segundos escolhe o trecho mais forte da música. Se não gostar, ajuste no mixer e peça outra.</li>
      </ul>

      <h2>Perguntas rápidas</h2>
      <ul className="list-disc pl-5">
        <li>
          <strong className="text-text">Meus arquivos ficam guardados?</strong> Na Produção, por 30 dias no seu Cofre, para baixar e pedir revisões; depois são apagados. Veja a{" "}
          <Link href="/privacidade" className="underline">
            Política de Privacidade
          </Link>
          .
        </li>
        <li>
          <strong className="text-text">E se algo falhar?</strong> Nada é cobrado por uma etapa que não terminou. Se um pagamento foi feito e o resultado não saiu como esperado, chame no WhatsApp
          que refazemos ou devolvemos o valor.
        </li>
        <li>
          <strong className="text-text">A música continua minha?</strong> Sempre. Veja os{" "}
          <Link href="/termos" className="underline">
            Termos
          </Link>
          .
        </li>
      </ul>
    </>
  );
}
