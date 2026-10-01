"use client";

import { resampleMono } from "@/lib/dsp/resample";
import type { Signal } from "@/lib/dsp/types";
import type { AsrModel, AsrRequest, AsrResponse } from "./asr.worker";
import type { Word } from "./model";

export type { AsrModel };
export type TranscribeProgress = { stage: "download" | "transcribe"; value: number };

/**
 * Um Worker por transcrição, encerrado no fim: a IA ocupa centenas de MB e, mantida na memória,
 * somava com a exportação do vídeo e fazia o celular fechar a página. Os arquivos do modelo ficam
 * no cache do navegador, então a próxima vez carrega do aparelho, sem baixar de novo.
 */
let current: Worker | null = null;

export function transcribe(
  channels: Signal,
  sampleRate: number,
  opts: { model: AsrModel; language: string; translate?: boolean },
  onProgress: (p: TranscribeProgress) => void,
): Promise<Word[]> {
  current?.terminate();
  const w = new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" });
  current = w;
  const finish = () => {
    w.terminate();
    if (current === w) current = null;
  };

  const audio = resampleMono(channels.slice(0, 2), sampleRate, 16000);

  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<AsrResponse>) => {
      const m = e.data;
      if (m.type === "download") onProgress({ stage: "download", value: m.progress });
      else if (m.type === "progress") onProgress({ stage: "transcribe", value: m.value });
      else if (m.type === "done") {
        finish();
        resolve(m.words);
      } else {
        finish();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      finish();
      reject(new Error(e.message || "Falha ao carregar o reconhecimento de fala"));
    };
    const req: AsrRequest = { audio, model: opts.model, language: opts.language, translate: Boolean(opts.translate) };
    w.postMessage(req, [audio.buffer]);
  });
}
