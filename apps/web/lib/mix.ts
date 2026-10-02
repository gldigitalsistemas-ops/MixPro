/**
 * Organização da mixagem no estúdio: abas, instrumentos, bases "do zero", amplificador e masterização.
 *
 * Fluxo: escolher o som (preset ou personalizar do zero) → [amplificador e caixa] → masterização
 * opcional no fim. A cadeia final = cadeia da mixagem (sem o limitador do fim) + cadeia do master.
 */
import { AMP_MODELS, MODULES, type ModuleType, type ParamSpec } from "@mixpro/contracts";
import type { ChainDoc, ChainStep } from "@/lib/dsp/chain";
import type { StudioCategory, StudioPreset } from "@/lib/presets";
import { freezeChain } from "@/lib/user-presets";

// ------------------------------------------------------------------ abas

export type SoundTab = "voz" | "instrumentos" | "amplificadores" | "musica";

export const SOUND_TABS: Record<SoundTab, { label: string; groups: readonly string[] }> = {
  voz: { label: "Voz", groups: ["vocal"] },
  instrumentos: { label: "Instrumentos", groups: ["drums", "guitar", "bass", "acoustic", "piano"] },
  amplificadores: { label: "Amplificadores", groups: [] },
  musica: { label: "Música pronta", groups: ["master"] },
};
export const DEFAULT_TAB_ORDER: SoundTab[] = ["voz", "instrumentos", "amplificadores", "musica"];

/** Ordem das abas definida no admin (o que faltar vai para o fim, o que não existir é ignorado). */
export function tabOrder(saved: unknown): SoundTab[] {
  const list = Array.isArray(saved) ? saved.filter((t): t is SoundTab => typeof t === "string" && t in SOUND_TABS) : [];
  return [...new Set([...list, ...DEFAULT_TAB_ORDER])];
}

export const tabOfCategory = (c: StudioCategory | undefined): SoundTab =>
  (Object.entries(SOUND_TABS).find(([, t]) => c && t.groups.includes(c.groupId))?.[0] as SoundTab | undefined) ?? "voz";

/** Categoria de masterização (Música pronta): não recebe outro master por cima. */
export const isMasterCategory = (c: StudioCategory | undefined) => c?.groupId === "master";

// ------------------------------------------------------------------ instrumentos

export type Instrument = "drums" | "guitar" | "bass" | "acoustic" | "piano";

export const INSTRUMENTS: { id: Instrument; label: string; strings: boolean }[] = [
  { id: "drums", label: "Bateria", strings: false },
  { id: "guitar", label: "Guitarra", strings: true },
  { id: "bass", label: "Baixo", strings: true },
  { id: "acoustic", label: "Violão", strings: true },
  { id: "piano", label: "Teclado", strings: false },
];

export const instrumentOf = (c: StudioCategory | undefined): Instrument | null =>
  (INSTRUMENTS.find((i) => i.id === c?.groupId)?.id as Instrument | undefined) ?? null;

// ------------------------------------------------------------------ módulos

/** Módulo com os valores padrão de cada parâmetro. */
export function defaultStep(type: ModuleType): ChainStep {
  const params: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(MODULES[type].params) as [string, ParamSpec][]) params[name] = p.default;
  if (type === "reverb" || type === "delay") params.mix = 15;
  if (type === "saturation") params.mix = 50;
  return { type, params };
}

const step = (type: ModuleType, params: Record<string, unknown>): ChainStep => {
  const base = defaultStep(type);
  return { type, params: { ...base.params, ...params } };
};
const hp = (f: number) => step("highpass", { frequency_hz: f, slope_db_oct: "12" });
const peak = (f: number, g: number, q = 1) => step("eq_peak", { frequency_hz: f, gain_db: g, q });
const shelf = (position: "low" | "high", f: number, g: number) => step("eq_shelf", { position, frequency_hz: f, gain_db: g, q: 0.7 });
const comp = (thr: number, ratio: number, att: number, rel: number, mk: number) =>
  step("compressor", { threshold_db: thr, ratio, attack_ms: att, release_ms: rel, knee_db: 6, makeup_db: mk });
const rev = (size: number, mix: number) => step("reverb", { room_size: size, damping: 50, width: 100, predelay_ms: 12, mix });
const lim = () => step("limiter", { ceiling_db: -1, input_gain_db: 0, release_ms: 60, lookahead_ms: 5 });

/**
 * Base para "Personalizar do zero": todos os módulos já no lugar, com valores neutros e seguros.
 * Guitarra e baixo vêm com amplificador (dá para tirar); a bateria vem com os samples de estúdio.
 */
export function starterChain(kind: Instrument | "voz"): ChainDoc {
  const chain: ChainStep[] = (() => {
    switch (kind) {
      case "drums":
        return [step("drum_studio", {}), comp(-16, 3, 15, 120, 2), lim()];
      case "guitar":
        return [step("amp", { model: "clean_us", gain: 3, ir: "mp:g-2x12-alnico", blend: 100 }), hp(90), peak(300, -2), comp(-20, 3, 12, 120, 2), rev(55, 12), lim()];
      case "bass":
        return [step("amp", { model: "bass_clean", gain: 3, ir: "mp:b-4x10-tweeter", blend: 100 }), hp(35), peak(300, -2), comp(-20, 4, 15, 150, 2), lim()];
      case "acoustic":
        return [hp(80), peak(220, -2.5), shelf("high", 10000, 2.5), comp(-20, 2.5, 15, 150, 2), rev(55, 14), lim()];
      case "piano":
        return [hp(40), peak(300, -2), shelf("high", 10000, 1.5), comp(-20, 2, 20, 200, 1.5), rev(65, 16), lim()];
      case "voz":
        return [hp(80), peak(300, -2), peak(3000, 2), shelf("high", 10000, 2), comp(-18, 3, 10, 120, 3), rev(50, 10), lim()];
    }
  })();
  return { schema_version: 1, chain };
}

const LABEL: Record<Instrument | "voz", string> = { drums: "bateria", guitar: "guitarra", bass: "baixo", acoustic: "violão", piano: "teclado", voz: "voz" };

/** Preset "do zero" (não existe no catálogo): o usuário monta e salva em Meus presets. */
export function starterPreset(kind: Instrument | "voz", categoryId: string): StudioPreset {
  return {
    id: `tpl-${kind}`,
    slug: `do-zero-${kind}`,
    name: `Minha mixagem de ${LABEL[kind]}`,
    description: "Criada do zero por você.",
    style: null,
    categoryId,
    chain: starterChain(kind),
    defaultIntensity: 100,
  };
}

/** Sem nenhum tratamento ("Fazer minha mixagem"): ponto de partida limpo. */
export function originalPreset(categoryId: string): StudioPreset {
  return {
    id: "orig",
    slug: "som-original",
    name: "Som original",
    description: "Sem tratamento. Escolha um preset ou personalize do zero.",
    style: null,
    categoryId,
    chain: { schema_version: 1, chain: [] },
    defaultIntensity: 100,
  };
}

/** Preset que não vem do catálogo (não tem base para salvar como cópia). */
export const isVirtualPreset = (id: string) => id === "orig" || id.startsWith("tpl-") || id.startsWith("s-");

// ------------------------------------------------------------------ amplificador

export type AmpChoice = { model: string; ir: string } | null;

export const ampGroup = (model: string): "guitar" | "bass" => (AMP_MODELS.find((m) => m.value === model)?.group ?? "guitar") as "guitar" | "bass";

export function ampOf(doc: ChainDoc | null): AmpChoice {
  const a = doc?.chain.find((m) => m.type === "amp" && !m.bypass);
  return a ? { model: String(a.params?.model ?? "clean_us"), ir: String(a.params?.ir ?? "") } : null;
}

/** Põe, troca ou tira o amplificador (ele fica antes da equalização: depois de gate, pedais e bateria). */
export function setAmp(doc: ChainDoc, choice: AmpChoice): ChainDoc {
  const chain = doc.chain.filter((m) => m.type !== "amp");
  if (!choice) return { ...doc, chain };
  const old = doc.chain.find((m) => m.type === "amp");
  const amp: ChainStep = old
    ? { ...old, bypass: false, params: { ...old.params, model: choice.model, ir: choice.ir } }
    : step("amp", { model: choice.model, ir: choice.ir, gain: 4, blend: 100 });
  let i = 0;
  while (i < chain.length && ["gate", "drum_studio", "overdrive", "chorus", "octaver"].includes(chain[i].type)) i++;
  chain.splice(i, 0, amp);
  return { ...doc, chain };
}

// ------------------------------------------------------------------ masterização

/**
 * Master no fim da mixagem: tira o limitador do fim da mixagem (o master tem o seu) e acrescenta
 * a cadeia do master, já na intensidade padrão dele.
 */
export function withMaster(mix: ChainDoc, master: StudioPreset | null): ChainDoc {
  if (!master) return mix;
  const chain = [...mix.chain];
  while (chain.length && chain[chain.length - 1].type === "limiter") chain.pop();
  return { ...mix, chain: [...chain, ...freezeChain(master.chain, master.defaultIntensity).chain] };
}
