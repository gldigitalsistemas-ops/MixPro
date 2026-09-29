/// <reference lib="webworker" />
import { finalizeForSocial, runChain, type ChainDoc } from "./chain";
import { integratedLoudness, samplePeak } from "./loudness";
import type { Signal } from "./types";

export type DspRequest = {
  id: number;
  channels: Signal;
  sampleRate: number;
  chain: ChainDoc;
  intensity: number;
  /** Aplica o ajuste final de loudness para redes (-14 LUFS, teto -1 dBFS). */
  social: boolean;
  /** Amostras iniciais usadas só para "aquecer" dinâmica/reverb; são descartadas na saída. */
  preroll: number;
};

export type DspResponse =
  | { id: number; type: "progress"; value: number }
  | { id: number; type: "done"; channels: Signal; lufs: number; peak: number }
  | { id: number; type: "error"; message: string };

const post = (msg: DspResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<DspRequest>) => {
  const { id, channels, sampleRate, chain, intensity, social, preroll } = e.data;
  try {
    let out = runChain(channels, sampleRate, chain, intensity, (done, total) =>
      post({ id, type: "progress", value: done / (total + (social ? 1 : 0)) }),
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
