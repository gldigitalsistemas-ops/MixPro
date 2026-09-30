/// <reference lib="webworker" />
import { finalizeForSocial, runChain, type ChainDoc } from "./chain";
import { denoise } from "./denoise";
import { integratedLoudness, samplePeak } from "./loudness";
import { setDrumSamples, type DrumSampleSet } from "./drums/studio";
import type { Signal } from "./types";

export type DspRequest = {
  id: number;
  channels: Signal;
  sampleRate: number;
  chain: ChainDoc;
  intensity: number;
  /** Aplica o ajuste final de loudness para redes (-14 LUFS, teto -1 dBFS). */
  social: boolean;
  /** Remoção de ruído antes do preset: 0 = desligada, 1 = total. */
  denoise: number;
  /** Amostras iniciais usadas só para "aquecer" dinâmica/reverb; são descartadas na saída. */
  preroll: number;
  /** Samples de bateria escolhidos (já na taxa de amostragem do áudio). */
  drumSamples?: DrumSampleSet;
};

export type DspResponse =
  | { id: number; type: "progress"; value: number }
  | { id: number; type: "done"; channels: Signal; lufs: number; peak: number }
  | { id: number; type: "error"; message: string };

const post = (msg: DspResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<DspRequest>) => {
  const { id, channels, sampleRate, chain, intensity, social, preroll } = e.data;
  // com remoção de ruído, ela ocupa a primeira metade da barra de progresso
  const split = e.data.denoise > 0 ? 0.5 : 0;
  try {
    setDrumSamples(e.data.drumSamples);
    const clean = await denoise(channels, sampleRate, e.data.denoise, (v) =>
      post({ id, type: "progress", value: v * split }),
    );
    let out = runChain(clean, sampleRate, chain, intensity, (done, total) =>
      post({ id, type: "progress", value: split + (1 - split) * (done / (total + (social ? 1 : 0))) }),
    );
    if (preroll > 0) out = out.map((ch) => ch.slice(preroll));
    if (social) out = finalizeForSocial(out, sampleRate);
    post(
      { id, type: "done", channels: out, lufs: integratedLoudness(out, sampleRate), peak: samplePeak(out) },
      out.map((c) => c.buffer),
    );
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
