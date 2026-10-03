/**
 * Edição salva no aparelho (IndexedDB, lib/session-store): o formato gravado e como ele volta.
 * Funções puras, sem React. O formato é o mesmo de antes desta extração: sessões já salvas no
 * aparelho de quem usa o app continuam abrindo (testado com um snapshot no formato antigo).
 */
import type { CaptionPosition, CaptionStyleId, Caption } from "@/lib/captions/model";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { DrumTweaks } from "@/lib/drums/tweaks";
import type { ColorLook } from "@/lib/media/color";
import type { AudiogramStyle, Fit, VideoFormat } from "@/lib/media/compose";
import type { CutLevel } from "@/lib/media/cuts";
import type { StudioPreset } from "@/lib/presets";
import type { ReverbTweak } from "@/lib/reverb-tweak";

/** Mesmos campos de components/studio (VideoToolsState e CaptionState), sem depender de componentes. */
export type SavedVideoTools = {
  cut: CutLevel;
  format: VideoFormat;
  fit: Fit;
  watermark: boolean;
  audiogram: AudiogramStyle | null;
  color: ColorLook;
  cta: { enabled: boolean; text: string | null; handle: string };
};
export type SavedCaptionState = { captions: Caption[]; style: CaptionStyleId; position: CaptionPosition; burnIn: boolean };

/** Tudo o que a edição grava. Os nomes das chaves são os de sempre (não renomeie). */
export type EditSnapshot<Tab extends string = string, Noise extends string = string, Niche extends string = string, Plat extends string = string> = {
  preset: StudioPreset | null;
  categoryId: string | null;
  intensity: number | null;
  noise: Noise | null;
  social: boolean;
  captionState: SavedCaptionState | null;
  videoTools: SavedVideoTools | null;
  drumTweaks: DrumTweaks | null;
  reverbTweak: ReverbTweak | null;
  custom: { presetId: string; chain: ChainDoc } | null;
  masterId: string | null;
  autoDecision: "aceito" | "manual" | null;
  niche: Niche | null;
  platform: Plat | null;
  postEdit: string | null;
  postVariant: number;
  tab: Tab;
};

/** O que vai para o aparelho: tudo, menos a imagem do audiograma (não é serializável). */
export function editSnapshot<S extends EditSnapshot>(e: S): S {
  return {
    ...e,
    videoTools: e.videoTools ? { ...e.videoTools, audiogram: e.videoTools.audiogram ? { ...e.videoTools.audiogram, image: null } : null } : null,
  };
}

/** Ao restaurar, as ferramentas de vídeo salvas entram por cima das atuais (a cor, campo a campo). */
export function mergeVideoTools<V extends SavedVideoTools>(cur: V | null, saved: V): V {
  return cur ? { ...cur, ...saved, color: { ...cur.color, ...saved.color } } : saved;
}

/**
 * O que restaurar de um registro salvo: só as chaves presentes (as ausentes não mudam nada).
 * `social`, `postVariant` e `tab` só voltam se tiverem o tipo certo; `videoTools` só se não for nulo.
 */
export function restorePatch(r: Record<string, unknown>): Partial<EditSnapshot> {
  const out: Record<string, unknown> = {};
  for (const k of ["preset", "categoryId", "intensity", "noise", "captionState", "drumTweaks", "reverbTweak", "custom", "masterId", "autoDecision", "niche", "platform", "postEdit"])
    if (k in r && r[k] !== undefined) out[k] = r[k];
  if (typeof r.social === "boolean") out.social = r.social;
  if (r.videoTools) out.videoTools = r.videoTools;
  if (typeof r.postVariant === "number") out.postVariant = r.postVariant;
  if (typeof r.tab === "string") out.tab = r.tab;
  return out as Partial<EditSnapshot>;
}
