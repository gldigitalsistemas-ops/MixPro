/**
 * Nichos de criadores: hashtags em português que as pessoas do nicho seguem, aberturas para
 * vídeos sem fala (quem toca um instrumento), chamadas para comentar e títulos de capa.
 * Lista curada (sem custo e sem IA na nuvem); dá para ajustar aqui quando as tendências mudarem.
 */

export type NicheId =
  | "louvor"
  | "bateria"
  | "guitarra"
  | "baixo"
  | "canto"
  | "producao"
  | "podcast"
  | "fe"
  | "dicas"
  | "humor"
  | "negocios"
  | "fitness"
  | "culinaria"
  | "beleza"
  | "tecnologia"
  | "vlog";

export type Niche = {
  id: NicheId;
  label: string;
  emoji: string;
  /** Da mais importante para a menos. */
  tags: string[];
  /** Aberturas quando o vídeo não tem fala (ou para variar). */
  hooks: string[];
  ctas: string[];
  /** Títulos curtos para a capa. */
  covers: string[];
};

export const NICHES: Niche[] = [
  {
    id: "louvor",
    label: "Louvor / Worship",
    emoji: "🙏",
    tags: ["louvor", "worship", "adoracao", "musicagospel", "gospel", "ministeriodelouvor", "worshipbrasil", "igreja"],
    hooks: ["Um momento de adoração pra abençoar o seu dia 🙏", "Esse louvor fala direto ao coração 🙌", "Adorando com o que temos nas mãos 🎶"],
    ctas: ["Marque alguém que precisa ouvir isso hoje 🙏", "Comenta “amém” se esse louvor tocou você", "Salve pra ouvir de novo quando precisar"],
    covers: ["Momento de adoração", "Louvor que toca", "Worship ao vivo"],
  },
  {
    id: "bateria",
    label: "Bateria",
    emoji: "🥁",
    tags: ["bateria", "baterista", "drums", "drummer", "drumcover", "bateristasdobrasil", "groove", "drumming"],
    hooks: ["Groove de hoje 🥁🔥", "Bateria gravada no celular com som de estúdio 🥁", "Essa virada ficou pesada 🔥", "Tirando essa no ouvido 🥁"],
    ctas: ["Comenta qual música você quer ver na próxima 👇", "Qual kit você prefere: esse ou o de antes?", "Marca um baterista que precisa ver isso"],
    covers: ["Groove pesado", "Som de estúdio", "Virada insana"],
  },
  {
    id: "guitarra",
    label: "Guitarra / Violão",
    emoji: "🎸",
    tags: ["guitarra", "guitarrista", "guitar", "guitarcover", "violao", "violonista", "riff", "musicabrasileira"],
    hooks: ["Riff do dia 🎸", "Timbre montado no celular 🎸🔥", "Tocando essa do jeito que eu gosto 🎶"],
    ctas: ["Qual música eu toco na próxima? 👇", "Salva pra tirar depois 🎸", "Marca um guitarrista"],
    covers: ["Riff do dia", "Timbre absurdo", "Cover na guitarra"],
  },
  {
    id: "baixo",
    label: "Baixo",
    emoji: "🎸",
    tags: ["baixo", "baixista", "bass", "bassplayer", "basscover", "groove", "slap", "baixistasdobrasil"],
    hooks: ["Groove de baixo pra alegrar o dia 🎸", "Linha de baixo que segura tudo 🔥", "Slap de hoje 👊"],
    ctas: ["Comenta a próxima música 👇", "Marca um baixista", "Salva pra estudar depois"],
    covers: ["Groove no baixo", "Slap pesado", "Linha de baixo"],
  },
  {
    id: "canto",
    label: "Canto / Cover",
    emoji: "🎤",
    tags: ["cover", "cantor", "cantora", "voz", "cantando", "vocal", "musica", "acustico"],
    hooks: ["Um pedacinho dessa música que eu amo 🎤", "Cover com som de estúdio, gravado no celular 🎶", "Cantando essa pra vocês 💜"],
    ctas: ["Qual música eu canto na próxima? 👇", "Manda pra quem ama essa música", "Salva e ouve de novo 🎧"],
    covers: ["Cover especial", "Voz e violão", "Canta comigo"],
  },
  {
    id: "producao",
    label: "Produção musical",
    emoji: "🎛️",
    tags: ["producaomusical", "produtormusical", "homestudio", "mixagem", "beat", "musica", "masterizacao", "studio"],
    hooks: ["Antes e depois da mixagem 🎛️", "Do celular pro som de estúdio 🎧", "Olha a diferença que a mix faz 🔥"],
    ctas: ["Qual versão você prefere? 👇", "Salva pra usar no seu próximo som", "Manda pra quem produz"],
    covers: ["Antes x depois", "Mix de estúdio", "Diferença absurda"],
  },
  {
    id: "podcast",
    label: "Podcast / Cortes",
    emoji: "🎙️",
    tags: ["podcast", "podcastbrasil", "cortes", "cortespodcast", "entrevista", "conversa", "reflexao"],
    hooks: ["Esse trecho merecia um vídeo só pra ele 🎙️", "Um corte que vale a pena ouvir até o fim 👀"],
    ctas: ["Você concorda? Comenta 👇", "Manda pra quem precisa ouvir isso", "Episódio completo no perfil"],
    covers: ["Você precisa ouvir isso", "Corte do podcast", "Ninguém fala disso"],
  },
  {
    id: "fe",
    label: "Fé / Pregação",
    emoji: "✝️",
    tags: ["fe", "deus", "palavradedeus", "jesus", "reflexao", "pregacao", "devocional", "motivacao"],
    hooks: ["Uma palavra pro seu dia ✝️", "Deus tem um recado pra você hoje 🙏"],
    ctas: ["Comenta “amém” 🙏", "Envie pra alguém que precisa dessa palavra", "Salve pra ler de novo"],
    covers: ["Palavra pra hoje", "Deus no controle", "Não desista"],
  },
  {
    id: "dicas",
    label: "Dicas / Educação",
    emoji: "💡",
    tags: ["dicas", "aprenda", "educacao", "conhecimento", "voceprecisasaber", "aprendanotiktok", "estudos"],
    hooks: ["Dica rápida que muda tudo 💡", "Pouca gente sabe disso 👀", "Salva essa dica 📌"],
    ctas: ["Salva pra não esquecer 📌", "Manda pra quem precisa saber disso", "Quer a parte 2? Comenta 👇"],
    covers: ["Pouca gente sabe", "Dica de ouro", "Faça isso hoje"],
  },
  {
    id: "humor",
    label: "Humor",
    emoji: "😂",
    tags: ["humor", "comedia", "memes", "engracado", "risada", "viral", "zoeira"],
    hooks: ["Quem nunca? 😂", "Não aguento mais 😂", "Isso aconteceu mesmo 🤣"],
    ctas: ["Marca aquele amigo 😂", "Comenta se já aconteceu com você", "Manda no grupo da família"],
    covers: ["Quem nunca?", "Não acredito", "Olha isso"],
  },
  {
    id: "negocios",
    label: "Negócios / Vendas",
    emoji: "💼",
    tags: ["empreendedorismo", "negocios", "marketingdigital", "vendas", "empreender", "sucesso", "dinheiro"],
    hooks: ["O erro que trava o seu negócio 💼", "Faça isso e venda mais 📈"],
    ctas: ["Salva e aplica hoje 📈", "Comenta “quero” que eu te explico", "Manda pra um sócio"],
    covers: ["Venda mais", "Erro que trava", "Faça isso hoje"],
  },
  {
    id: "fitness",
    label: "Fitness / Treino",
    emoji: "💪",
    tags: ["fitness", "treino", "academia", "vidasaudavel", "saude", "treinoemcasa", "foco"],
    hooks: ["Treino de hoje 💪", "Faça isso e sinta a diferença 🔥"],
    ctas: ["Salva o treino 📌", "Marca seu parceiro de treino", "Comenta seu objetivo 👇"],
    covers: ["Treino de hoje", "Sem desculpa", "Faça isso"],
  },
  {
    id: "culinaria",
    label: "Culinária / Receitas",
    emoji: "🍳",
    tags: ["receita", "receitas", "culinaria", "receitasfaceis", "comida", "cozinha", "comidacaseira"],
    hooks: ["Receita fácil pra hoje 🍳", "Fica pronto em minutos 😋"],
    ctas: ["Salva a receita 📌", "Marca quem vai fazer pra você", "Comenta se faria 👇"],
    covers: ["Receita fácil", "Pronto em minutos", "Fica perfeito"],
  },
  {
    id: "beleza",
    label: "Beleza / Moda",
    emoji: "💄",
    tags: ["beleza", "maquiagem", "make", "skincare", "moda", "autoestima", "dicasdebeleza"],
    hooks: ["Make de hoje 💄", "Testei e aprovei ✨"],
    ctas: ["Salva pra fazer depois ✨", "Comenta qual produto você quer ver", "Marca uma amiga"],
    covers: ["Make fácil", "Testei e aprovei", "Antes e depois"],
  },
  {
    id: "tecnologia",
    label: "Tecnologia",
    emoji: "📱",
    tags: ["tecnologia", "tech", "dicasdetecnologia", "celular", "apps", "iphone", "android"],
    hooks: ["Truque de celular que pouca gente conhece 📱", "App que salvou meu dia 🔥"],
    ctas: ["Salva pra testar depois 📌", "Comenta se já conhecia", "Manda pra quem precisa"],
    covers: ["Truque escondido", "Você não sabia", "App incrível"],
  },
  {
    id: "vlog",
    label: "Vlog / Dia a dia",
    emoji: "📷",
    tags: ["vlog", "diaadia", "rotina", "lifestyle", "vidareal", "umdiacomigo"],
    hooks: ["Um pouco do meu dia 📷", "Vem comigo ✨"],
    ctas: ["Comenta o que você quer ver amanhã 👇", "Salva pra acompanhar", "Me segue pra ver a parte 2"],
    covers: ["Um dia comigo", "Vem comigo", "Rotina real"],
  },
];

export type Platform = "instagram" | "tiktok" | "youtube" | "facebook";

export const PLATFORMS: { id: Platform; label: string; tags: number; extra: string[] }[] = [
  // o Instagram limita as hashtags por post; poucas e certeiras funcionam melhor
  { id: "instagram", label: "Instagram", tags: 5, extra: ["reels"] },
  { id: "tiktok", label: "TikTok", tags: 5, extra: ["fyp"] },
  { id: "youtube", label: "YouTube Shorts", tags: 3, extra: ["shorts"] },
  { id: "facebook", label: "Facebook", tags: 3, extra: [] },
];

/**
 * Chamadas para o final do vídeo (CTA), conforme o nicho: as do nicho primeiro, depois as
 * que funcionam em qualquer conteúdo (seguir, salvar, compartilhar).
 */
export function ctaOptions(niche: Niche | null): string[] {
  const follow = niche ? `Segue pra mais ${niche.label.split(" /")[0].toLocaleLowerCase("pt-BR")} ${niche.emoji}` : "Segue pra mais conteúdo assim ✨";
  const generic = [follow, "Comenta aqui 👇", "Salva pra ver depois 📌", "Manda pra um amigo 📲"];
  return [...(niche?.ctas ?? []), ...generic].filter((c, i, a) => a.indexOf(c) === i).slice(0, 6);
}

export const nicheById =(id: string | null | undefined) => NICHES.find((n) => n.id === id) ?? null;

/** Nicho sugerido pelo que a análise encontrou no áudio e pelo preset escolhido. */
export function suggestNiche(contentKind: string | null | undefined, presetCategory: string | null | undefined): NicheId | null {
  const cat = presetCategory ?? "";
  if (/gospel|worship/.test(cat)) return "louvor";
  if (cat.startsWith("drums") || contentKind === "drums") return "bateria";
  if (cat.startsWith("bass")) return "baixo";
  if (cat.startsWith("guitar")) return "guitarra";
  if (contentKind === "singing" || cat.startsWith("vocal-pop") || cat.startsWith("vocal-rock")) return "canto";
  if (cat === "vocal-podcast") return "podcast";
  if (contentKind === "music" || cat.startsWith("master")) return "producao";
  return null;
}
