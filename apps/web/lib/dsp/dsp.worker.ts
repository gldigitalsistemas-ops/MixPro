/// <reference lib="webworker" />
import type { ChainDoc } from "./chain";
import type { DrumSampleSet } from "./drums/studio";
import type { Signal } from "./types";
import { processAudio } from "@/lib/export/process-audio";

export type DspRequest = {
  id: number;
  channels: Signal;
  sampleRate: number;
  chain: ChainDoc;
  intensity: number;
  /** Aplica o ajuste final de loudness para redes (-14 LUFS, teto -1 dBFS). */
  social: boolean;
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

export type DspResponse =
  | { id: number; type: "progress"; value: number }
  | { id: number; type: "done"; channels: Signal; lufs: number; peak: number }
  | { id: number; type: "error"; message: string };

const post = (msg: DspResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

// o processamento em si fica em lib/export/process-audio.ts (o mesmo código roda em Node)
self.onmessage = async (e: MessageEvent<DspRequest>) => {
  const { id, channels, sampleRate } = e.data;
  try {
    const out = await processAudio(channels, sampleRate, e.data, (value) => post({ id, type: "progress", value }));
    post({ id, type: "done", channels: out.channels, lufs: out.lufs, peak: out.peak }, out.channels.map((c) => c.buffer));
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
