/**
 * Lembretes inteligentes: a notificação do dia muda conforme o que a pessoa usou.
 * Prioridade: arquivo prestes a expirar > sugestão a partir da última ferramenta > saudade (7+ dias
 * sem usar) > mensagem do dia. Só usa sinais do próprio app (nada de conteúdo dos arquivos).
 */
import type { PushMessage } from "./messages";

export type UserContext = {
  /** Ferramenta com arquivos prontos que expiram nas próximas horas. */
  expiringTool?: string | null;
  /** Última ferramenta usada nos últimos 30 dias. */
  lastTool?: string | null;
  /** Dias desde o último download (null: nunca baixou). */
  daysSinceActive?: number | null;
};

const TOOL_NAMES: Record<string, string> = {
  pitch_tempo: "Tom e andamento",
  voice_playback: "Voz + Playback",
  reference_master: "Masterização por referência",
  album: "Modo álbum",
  stems: "Separação de faixas",
  convert: "Conversão",
};

const NEXT_STEP: Record<string, PushMessage> = {
  pitch_tempo: { title: "Tom certo, agora o som 🎚️", body: "Grave a voz por cima e use Voz + Playback para mixar tudo junto.", url: "/ferramentas?ferramenta=voice_playback" },
  voice_playback: { title: "Ficou bom? Deixe com som de disco 💿", body: "Masterize pela sua música de referência e chegue no mesmo brilho e volume.", url: "/ferramentas?ferramenta=reference_master" },
  reference_master: { title: "Tem mais músicas no projeto? 📀", body: "O Modo álbum deixa todas as faixas com o mesmo volume e timbre.", url: "/ferramentas?ferramenta=album" },
  album: { title: "Álbum pronto? Mostre para alguém 🔗", body: "Crie um link de antes e depois e mande para a banda ou o cliente.", url: "/estudio" },
  stems: { title: "Pistas separadas? Monte seu VS 🎛️", body: "Abra o VS e toque ao vivo com o clique no andamento da música.", url: "/vs" },
  convert: { title: "Arquivo convertido ✅", body: "Agora abra no Studio e deixe o som com cara de estúdio.", url: "/estudio" },
};

const MISS_YOU: PushMessage = { title: "Faz tempo que você não aparece 👋", body: "Tem gravação parada no celular? Envie e ouça o antes e depois em minutos.", url: "/estudio" };

export function smartMessage(ctx: UserContext | undefined, daily: PushMessage): PushMessage {
  if (ctx?.expiringTool) {
    const name = TOOL_NAMES[ctx.expiringTool] ?? "ferramentas";
    return { title: "Seus arquivos expiram em breve ⏳", body: `Os arquivos de ${name} saem do ar nas próximas horas. Baixe em Meus projetos.`, url: "/projetos" };
  }
  if (ctx?.lastTool && NEXT_STEP[ctx.lastTool]) return NEXT_STEP[ctx.lastTool];
  if (ctx?.daysSinceActive !== undefined && ctx.daysSinceActive !== null && ctx.daysSinceActive >= 7) return MISS_YOU;
  return daily;
}
