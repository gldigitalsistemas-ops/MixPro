/**
 * Ajuste automático ao importar: a partir da análise do áudio, escolhe o preset inicial,
 * a remoção de ruído e explica em linguagem simples o que foi feito.
 */
import type { AudioAnalysis, ContentKind, InstrumentGuess, InstrumentType, RecordingSource } from "@/lib/dsp/analyze";
import type { StudioPreset } from "@/lib/presets";

export type NoiseChoice = "off" | "light" | "strong";

export type AutoSetup = {
  kind: ContentKind;
  /** Categorias preferidas, em ordem (a primeira que existir no catálogo vale). */
  categories: string[];
  noise: NoiseChoice;
  /** Frases para o cartão "Ajuste automático". */
  notes: string[];
  /** Palpite incerto: sugere conferir a categoria. */
  unsure: boolean;
  /** Instrumento e forma de gravar (o usuário confirma ou troca no cartão). */
  instrument: InstrumentGuess | null;
};

export const INSTRUMENT_LABEL: Record<InstrumentType, string> = {
  violao: "Violão",
  guitarra: "Guitarra",
  baixo: "Baixo",
  teclado: "Teclado/piano",
};
export const SOURCE_LABEL: Record<RecordingSource, string> = { mic: "Celular ou microfone", plugado: "Plugado no cabo" };

/** Categorias de preset para cada instrumento e forma de gravar (a primeira que existir vale). */
const INSTRUMENT_CATEGORIES: Record<InstrumentType, Record<RecordingSource, string[]>> = {
  violao: { mic: ["violao-celular", "guitar-acoustic"], plugado: ["violao-plugado", "guitar-acoustic"] },
  guitarra: { mic: ["guitar-mic", "guitar-electric"], plugado: ["guitar-amp", "guitar-electric"] },
  baixo: { mic: ["bass-mic", "bass-electric"], plugado: ["bass-amp", "bass-electric"] },
  teclado: { mic: ["teclado-celular", "piano-keys"], plugado: ["teclado-plugado", "piano-keys"] },
};

export function instrumentCategories(g: InstrumentGuess): string[] {
  return INSTRUMENT_CATEGORIES[g.type][g.source];
}

/** Qual instrumento/gravação corresponde a uma categoria (para marcar a escolha atual no cartão). */
export function instrumentOfCategory(categoryId: string | undefined | null): InstrumentGuess | null {
  if (!categoryId) return null;
  for (const [type, bySource] of Object.entries(INSTRUMENT_CATEGORIES) as [InstrumentType, Record<RecordingSource, string[]>][]) {
    for (const [source, cats] of Object.entries(bySource) as [RecordingSource, string[]][]) {
      if (cats[0] === categoryId) return { type, source };
    }
  }
  return null;
}

export const KIND_LABEL: Record<ContentKind, string> = {
  speech: "fala",
  singing: "voz cantada",
  drums: "bateria",
  instrument: "instrumento",
  music: "música pronta",
};

export function autoSetup(a: AudioAnalysis, mediaKind: "video" | "audio"): AutoSetup {
  const notes: string[] = [];
  let categories: string[];
  switch (a.kind) {
    case "speech":
      categories = mediaKind === "video" ? ["vocal-criador", "vocal-podcast"] : ["vocal-podcast", "vocal-criador"];
      notes.push("Voz de criador: presença, clareza e volume constante.");
      break;
    case "singing":
      categories = ["vocal-pop", "vocal-gospel", "vocal-rock"];
      notes.push("Vocal: brilho, corpo e compressão de estúdio.");
      break;
    case "drums":
      categories = ["drums-estudio", "drums-acoustic"];
      notes.push("Bateria de estúdio: bumbo, caixa e tons reforçados com samples.");
      break;
    case "instrument": {
      const g = a.instrument ?? { type: "violao", source: "mic" };
      categories = [...instrumentCategories(g), "master-main"];
      const o = g.type === "guitarra" ? "a" : "o";
      notes.push(
        g.source === "plugado"
          ? `Parece ${INSTRUMENT_LABEL[g.type].toLowerCase()} plugad${o} no cabo: simulamos o som de estúdio (amplificador, caixa e ambiência).`
          : `Parece ${INSTRUMENT_LABEL[g.type].toLowerCase()} gravad${o} no celular ou microfone: tiramos o som de celular e devolvemos corpo, brilho e ambiência.`,
      );
      break;
    }
    default:
      categories = ["master-main"];
      notes.push("Masterização: volume e brilho no padrão das plataformas.");
  }

  const noise: NoiseChoice = a.noise === "noisy" ? "strong" : a.noise === "some" ? "light" : "off";
  if (noise === "strong") notes.push("Muito ruído de fundo (ventilador, ar, rua): remoção de ruído no máximo.");
  else if (noise === "light") notes.push("Um pouco de ruído de fundo: redução natural ligada.");
  else if (a.kind === "speech") notes.push("Gravação limpa: remoção de ruído desligada para não mexer na voz.");
  else {
    const what = a.kind === "drums" ? "da bateria" : a.kind === "music" ? "da música" : a.kind === "singing" ? "do canto" : "do instrumento";
    notes.push(`Som original mantido (sem remoção de ruído): ela é feita para fala e estragaria o som ${what}. Se quiser, ligue em “Ruído de fundo”.`);
  }

  if (a.clipping > 0.0005) notes.push("A gravação estourou em alguns trechos. Da próxima vez, afaste um pouco o celular da fonte.");
  if (a.rumble > 0.25 && (a.kind === "speech" || a.kind === "singing")) notes.push("Grave de vento ou pancadas no microfone: o preset já corta essa região.");

  return { kind: a.kind, categories, noise, notes, unsure: a.confidence < 0.6, instrument: a.kind === "instrument" ? (a.instrument ?? { type: "violao", source: "mic" }) : null };
}

/** Primeiro preset da primeira categoria preferida que existir no catálogo. */
export function pickPreset(presets: StudioPreset[], categories: string[]): StudioPreset | null {
  for (const c of categories) {
    const p = presets.find((x) => x.categoryId === c);
    if (p) return p;
  }
  return null;
}
