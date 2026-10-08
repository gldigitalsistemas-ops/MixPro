/**
 * Processamento de áudio da exportação, sem DOM: roda no Web Worker do app (dsp.worker.ts) e em
 * Node (testes golden e o script do servidor). Ordem: samples/IRs → remoção de ruído → cadeia →
 * descarte do preroll → ajuste para redes.
 */
import { finalizeForSocial, runChain, type ChainDoc } from "@/lib/dsp/chain";
import { denoise as removeNoise } from "@/lib/dsp/denoise";
import { setImpulses } from "@/lib/dsp/amp";
import { setDrumSamples, type DrumSampleSet } from "@/lib/dsp/drums/studio";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";

export type ProcessAudioOptions = {
  chain: ChainDoc;
  intensity: number;
  /** Aplica o ajuste final de loudness para redes (-14 LUFS, teto -1 dBFS). */
  social: boolean;
  /** Destino do ajuste final; sem ele: -14 LUFS e teto de -1 dBFS. */
  delivery?: { targetLufs: number; ceilingDb: number };
  /** Remoção de ruído antes do preset: 0 = desligada, 1 = total. */
  denoise: number;
  /** Amostras iniciais usadas só para "aquecer" dinâmica/reverb; são descartadas na saída. */
  preroll: number;
  /** Samples de bateria escolhidos (já na taxa de amostragem do áudio). */
  drumSamples?: DrumSampleSet;
  /** Caixas gravadas (IR) do amplificador, por id. */
  impulses?: Record<string, Float32Array>;
};

export type ProcessAudioResult = { channels: Signal; lufs: number; peak: number };

/** `channels` pode ser alterado no lugar (o worker recebe uma cópia). `onProgress`: 0–1. */
export async function processAudio(
  channels: Signal,
  sampleRate: number,
  o: ProcessAudioOptions,
  onProgress?: (v: number) => void,
): Promise<ProcessAudioResult> {
  // com remoção de ruído, ela ocupa a primeira metade da barra de progresso
  const split = o.denoise > 0 ? 0.5 : 0;
  setDrumSamples(o.drumSamples);
  setImpulses(o.impulses);
  const clean = await removeNoise(channels, sampleRate, o.denoise, (v) => onProgress?.(v * split));
  let out = runChain(clean, sampleRate, o.chain, o.intensity, (done, total) =>
    onProgress?.(split + (1 - split) * (done / (total + (o.social ? 1 : 0)))),
  );
  if (o.preroll > 0) out = out.map((ch) => ch.slice(o.preroll));
  if (o.social) out = finalizeForSocial(out, sampleRate, o.delivery?.targetLufs ?? -14, o.delivery?.ceilingDb ?? -1);
  return { channels: out, lufs: integratedLoudness(out, sampleRate), peak: samplePeak(out) };
}
