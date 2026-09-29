"use client";

import { resample } from "@/lib/dsp/resample";
import type { Signal } from "@/lib/dsp/types";
import type { AsrModel, AsrRequest, AsrResponse } from "./asr.worker";
import type { Word } from "./model";

export type { AsrModel };
export type TranscribeProgress = { stage: "download" | "transcribe"; value: number };

/** Um Worker por sessão: o modelo fica em memória entre transcrições. */
let worker: Worker | null = null;

export function transcribe(
  channels: Signal,
  sampleRate: number,
  opts: { model: AsrModel; language: string; translate?: boolean },
  onProgress: (p: TranscribeProgress) => void,
): Promise<Word[]> {
  worker ??= new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" });
  const w = worker;

  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
  const audio = resample(mono, sampleRate, 16000);

  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<AsrResponse>) => {
      const m = e.data;
      if (m.type === "download") onProgress({ stage: "download", value: m.progress });
      else if (m.type === "progress") onProgress({ stage: "transcribe", value: m.value });
      else if (m.type === "done") resolve(m.words);
      else {
        worker?.terminate();
        worker = null;
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || "Falha ao carregar o reconhecimento de fala"));
    };
    const req: AsrRequest = { audio, model: opts.model, language: opts.language, translate: Boolean(opts.translate) };
    w.postMessage(req, [audio.buffer]);
  });
}
