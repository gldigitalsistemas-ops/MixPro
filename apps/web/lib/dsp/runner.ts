"use client";

import type { ChainDoc } from "./chain";
import type { DspRequest, DspResponse } from "./dsp.worker";
import type { Signal } from "./types";

export type DspResult = { channels: Signal; lufs: number; peak: number };

export type DspJob = {
  channels: Signal;
  sampleRate: number;
  chain: ChainDoc;
  intensity: number;
  social: boolean;
  denoise?: number;
  preroll?: number;
};

export class DspAbortError extends Error {
  constructor() {
    super("Processamento cancelado");
  }
}

/**
 * Um Worker por execução em andamento: cancelar = encerrar o Worker (não dá para
 * interromper um laço de DSP de outra forma). Os canais de entrada são copiados.
 */
export function runDsp(job: DspJob, onProgress?: (v: number) => void, signal?: AbortSignal): Promise<DspResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DspAbortError());
    const worker = new Worker(new URL("./dsp.worker.ts", import.meta.url), { type: "module" });
    const done = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      done();
      reject(new DspAbortError());
    };
    signal?.addEventListener("abort", onAbort);

    worker.onmessage = (e: MessageEvent<DspResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") onProgress?.(msg.value);
      else if (msg.type === "done") {
        done();
        resolve({ channels: msg.channels, lufs: msg.lufs, peak: msg.peak });
      } else {
        done();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || "Falha no processamento de áudio"));
    };

    const channels = job.channels.map((c) => c.slice());
    const req: DspRequest = {
      id: 1,
      channels,
      sampleRate: job.sampleRate,
      chain: job.chain,
      intensity: job.intensity,
      social: job.social,
      denoise: job.denoise ?? 0,
      preroll: job.preroll ?? 0,
    };
    worker.postMessage(req, channels.map((c) => c.buffer));
  });
}
