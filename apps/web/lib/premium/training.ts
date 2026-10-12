/**
 * Mapa de treino (só admin): o que juntar para os treinos por gênero (LoRA do gerador de bases) e para
 * calibrar o motor de mixagem (proporções de volume e timbre por instrumento em mixes reais).
 *
 * Cada música precisa de: direitos confirmados (própria ou de parceiro com autorização por escrito),
 * mix final em WAV e, de preferência, as faixas separadas (multipista) e a guia/voz crua.
 */
export type TrainingGenre = { id: string; name: string; target: number; minimum: number; why: string };

export const TRAINING_GENRES: TrainingGenre[] = [
  { id: "worship", name: "Worship", target: 50, minimum: 20, why: "Pads, guitarras com delay, dinâmica de subida — o estilo mais pedido pelos compositores gospel." },
  { id: "gospel", name: "Gospel BR", target: 50, minimum: 20, why: "Voz na frente e arranjos de banda gospel brasileira." },
  { id: "sertanejo", name: "Sertanejo", target: 50, minimum: 20, why: "Violão, sanfona e voz brilhante: os modelos internacionais não conhecem bem." },
  { id: "pagode", name: "Pagode/Samba", target: 40, minimum: 15, why: "Percussão e cavaco brasileiros." },
  { id: "funk", name: "Funk BR", target: 40, minimum: 15, why: "Grave e batida típicos do funk brasileiro." },
  { id: "pop_us", name: "Pop americano", target: 40, minimum: 15, why: "Referência de sonoridade internacional." },
  { id: "mpb", name: "MPB/Acústico", target: 40, minimum: 15, why: "Arranjos acústicos e voz e violão." },
];

export type TrainingTask = { id: string; title: string; detail: string };

/** Passo a passo de cada música (aparece no topo do Mapa de treino). */
export const TRAINING_STEPS: TrainingTask[] = [
  { id: "direitos", title: "1. Confirme os direitos", detail: "Use só produções suas ou de parceiros que autorizaram por escrito o uso para treinar a IA do Mix Pro. Anote quem autorizou." },
  { id: "mix", title: "2. Envie o mix final", detail: "WAV 24 bits (44,1 ou 48 kHz), sem o master se possível, ou o master final." },
  { id: "faixas", title: "3. Envie as faixas separadas", detail: "Voz, bateria, baixo, guitarra, violão, teclado e outros — todas começando no mesmo ponto. É o que mais ensina o motor de mixagem." },
  { id: "guia", title: "4. Se tiver, envie a guia", detail: "Voz e violão (ou a guia crua) da mesma música: ensina o gerador a sair da composição para a produção." },
  { id: "dados", title: "5. Preencha BPM, tom e gênero", detail: "O app sugere BPM e tom; confira e corrija." },
];

/** Tarefas da vitrine (exemplos próprios antes de abrir para todos). */
export const SHOWCASE_TARGETS: { product: string; name: string; target: number }[] = [
  { product: "vs_premium", name: "VS Premium 7 faixas", target: 3 },
  { product: "mix_ia", name: "Mix & Master IA", target: 4 },
  { product: "producao", name: "Produção da composição", target: 3 },
  { product: "voz_final", name: "Voz finalizada", target: 2 },
  { product: "estudio", name: "Estúdio (tratamento de áudio)", target: 3 },
];

export const TRAINING_KINDS = ["mix", "stem", "guia"] as const;
export type TrainingKind = (typeof TRAINING_KINDS)[number];

export type TrainingFileIn = { name: string; bytes: number; kind: TrainingKind };

/** Valida o envio: até 30 arquivos de áudio de até 500 MB cada. */
export function validTrainingFiles(files: unknown): TrainingFileIn[] | null {
  if (!Array.isArray(files) || files.length < 1 || files.length > 30) return null;
  const out: TrainingFileIn[] = [];
  for (const f of files as Record<string, unknown>[]) {
    const name = typeof f?.name === "string" ? f.name.split(/[\\/]/).pop()!.slice(-80) : "";
    const bytes = Number(f?.bytes);
    const kind = f?.kind as TrainingKind;
    if (!/\.(wav|aif|aiff|flac|mp3|m4a)$/i.test(name) || !Number.isInteger(bytes) || bytes < 1 || bytes > 500 * 1024 * 1024 || !(TRAINING_KINDS as readonly string[]).includes(kind)) return null;
    out.push({ name: name.replace(/[^A-Za-z0-9 ._()+-]+/g, "-"), bytes, kind });
  }
  if (!out.some((f) => f.kind === "mix")) return null;
  return out;
}
