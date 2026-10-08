"use client";

import { useState } from "react";
import { DEFAULT_DELIVERY, type DeliveryId, type Intensity } from "@mixpro/contracts";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { DrumTweaks } from "@/lib/drums/tweaks";
import type { StudioPreset } from "@/lib/presets";
import type { ReverbTweak } from "@/lib/reverb-tweak";
import type { CaptionState } from "./captions-panel";
import type { MusicState } from "./music-picker";
import type { NoiseLevel } from "./noise-selector";
import type { VideoToolsState } from "./video-tools";

/**
 * Estado da edição que define o arquivo final (som, legendas, vídeo, música), num lugar só.
 * Devolve os mesmos nomes de antes; o ExportJob é montado a partir destes valores.
 * O que é só da interface (abas, listas, prévia) continua no studio.tsx.
 */
export function useEditState() {
  // escolhas do usuário; null = usar o padrão (preset sugerido / intensidade do preset)
  const [chosenPreset, setPreset] = useState<StudioPreset | null>(null);
  const [chosenIntensity, setIntensity] = useState<Intensity | null>(null);
  const [social, setSocial] = useState(true);
  /** Destino do ajuste final de volume (vale quando `social` está ligado). */
  const [delivery, setDelivery] = useState<DeliveryId>(DEFAULT_DELIVERY);
  const [chosenNoise, setNoise] = useState<NoiseLevel | null>(null);
  const [captionState, setCaptionState] = useState<CaptionState | null>(null);
  const [videoTools, setVideoTools] = useState<VideoToolsState | null>(null);
  const [music, setMusic] = useState<MusicState | null>(null);
  const [drumTweaks, setDrumTweaks] = useState<DrumTweaks | null>(null);
  const [reverbTweak, setReverbTweak] = useState<ReverbTweak | null>(null);
  /** Masterização no fim da mixagem (id do preset de master; null = sem master). */
  const [masterId, setMasterId] = useState<string | null>(null);
  // "Personalizar": cadeia editada pelo usuário (vale enquanto o mesmo preset estiver escolhido)
  const [custom, setCustom] = useState<{ presetId: string; chain: ChainDoc } | null>(null);
  return {
    chosenPreset,
    setPreset,
    chosenIntensity,
    setIntensity,
    social,
    setSocial,
    delivery,
    setDelivery,
    chosenNoise,
    setNoise,
    captionState,
    setCaptionState,
    videoTools,
    setVideoTools,
    music,
    setMusic,
    drumTweaks,
    setDrumTweaks,
    reverbTweak,
    setReverbTweak,
    masterId,
    setMasterId,
    custom,
    setCustom,
  };
}
