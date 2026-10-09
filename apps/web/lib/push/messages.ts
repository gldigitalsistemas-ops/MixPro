/**
 * Mensagens da notificação diária: curtas, no tom do app, convidando a tratar um áudio.
 * Uma por dia, na ordem (o dia do ano escolhe), para não repetir a mesma mensagem dias seguidos.
 */
export type PushMessage = { title: string; body: string; url: string };

export const DAILY_MESSAGES: PushMessage[] = [
  { title: "E aí, já tratou seu áudio hoje? 🎧", body: "Grave, envie e deixe o Mix Pro deixar o som com cara de estúdio.", url: "/estudio" },
  { title: "Sua voz merece som de estúdio 🎙️", body: "Envie a gravação do celular e ouça a diferença no antes e depois.", url: "/estudio" },
  { title: "Gravou algo hoje? 🎸", body: "Violão, guitarra, baixo ou bateria: o Mix Pro mixa e masteriza em minutos.", url: "/estudio" },
  { title: "Bora soltar aquele cover? 🎤", body: "Trate o áudio no Mix Pro e poste com volume de rede social.", url: "/estudio" },
  { title: "Áudio baixo no vídeo? 📈", body: "O Mix Pro ajusta o volume para Instagram, TikTok e YouTube sem estourar.", url: "/estudio" },
  { title: "Um minuto para um som melhor ⏱️", body: "Envie o arquivo, escolha o destino e baixe pronto para publicar.", url: "/estudio" },
  { title: "Ruído no fundo da gravação? 🔇", body: "Veja o diagnóstico do seu áudio e deixe a fala mais limpa.", url: "/estudio" },
  { title: "Hoje é dia de ensaio? 🥁", body: "Grave no celular e transforme o ensaio em um áudio pronto para mostrar.", url: "/estudio" },
  { title: "Seu público ouve primeiro ✨", body: "Antes de postar, passe o áudio no Mix Pro e compare o antes e depois.", url: "/estudio" },
  { title: "Que tal separar a voz da música? 🎛️", body: "Experimente o VS e crie seu playback ou isole os instrumentos.", url: "/vs" },
  { title: "Pronto para gravar? 🎶", body: "O Mix Pro cuida da mixagem e da masterização. Você só aperta o play.", url: "/estudio" },
  { title: "Seu som pode ir além 🚀", body: "Teste os destinos Natural, Podcast, Redes e Alto e escolha o seu.", url: "/estudio" },
];

/** Mensagem do dia (horário de Brasília), girando pela lista. */
export function messageForDay(date: Date = new Date()): PushMessage {
  const brt = new Date(date.getTime() - 3 * 3600_000);
  const start = Date.UTC(brt.getUTCFullYear(), 0, 0);
  const day = Math.floor((brt.getTime() - start) / 86_400_000);
  return DAILY_MESSAGES[day % DAILY_MESSAGES.length];
}

/** Serviços de push aceitos (o servidor só envia para eles; evita chamar URLs arbitrárias). */
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)\//;

export type BrowserSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

export function validSubscription(v: unknown): BrowserSubscription | null {
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== "string" || s.endpoint.length > 1000 || !PUSH_HOSTS.test(s.endpoint)) return null;
  const p = s.keys?.p256dh;
  const a = s.keys?.auth;
  if (typeof p !== "string" || typeof a !== "string") return null;
  if (!/^[A-Za-z0-9_-]{40,200}={0,2}$/.test(p) || !/^[A-Za-z0-9_-]{10,100}={0,2}$/.test(a)) return null;
  return { endpoint: s.endpoint, keys: { p256dh: p, auth: a } };
}
