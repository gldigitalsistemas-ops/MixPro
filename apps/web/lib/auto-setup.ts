/**
 * Ajuste automático ao importar: a partir da análise do áudio, escolhe o preset inicial,
 * a remoção de ruído e explica em linguagem simples o que foi feito.
 */
import type { AudioAnalysis, ContentKind } from "@/lib/dsp/analyze";
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
};

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
    case "instrument":
      categories = ["master-main"];
      notes.push("Polimento leve. Se quiser, escolha o seu instrumento na aba Instrumentos.");
      break;
    default:
      categories = ["master-main"];
      notes.push("Masterização: volume e brilho no padrão das plataformas.");
  }

  const noise: NoiseChoice = a.noise === "noisy" ? "strong" : a.noise === "some" ? "light" : "off";
  if (noise === "strong") notes.push("Muito ruído de fundo (ventilador, ar, rua): remoção de ruído no máximo.");
  else if (noise === "light") notes.push("Um pouco de ruído de fundo: redução natural ligada.");
  else if (a.kind === "speech" || a.kind === "singing") notes.push("Gravação limpa: remoção de ruído desligada para não mexer na voz.");
  else {
    const what = a.kind === "drums" ? "da bateria" : a.kind === "music" ? "da música" : "do instrumento";
    notes.push(`Remoção de ruído desligada: ela é feita para voz e estragaria o som ${what}.`);
  }

  if (a.clipping > 0.0005) notes.push("A gravação estourou em alguns trechos. Da próxima vez, afaste um pouco o celular da fonte.");
  if (a.rumble > 0.25 && (a.kind === "speech" || a.kind === "singing")) notes.push("Grave de vento ou pancadas no microfone: o preset já corta essa região.");

  return { kind: a.kind, categories, noise, notes, unsure: a.confidence < 0.6 };
}

/** Primeiro preset da primeira categoria preferida que existir no catálogo. */
export function pickPreset(presets: StudioPreset[], categories: string[]): StudioPreset | null {
  for (const c of categories) {
    const p = presets.find((x) => x.categoryId === c);
    if (p) return p;
  }
  return null;
}
