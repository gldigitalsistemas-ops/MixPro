"use client";

import type { SeparateResponse } from "./separate.worker";

export type SeparateProgress =
  | { stage: "download"; value: number }
  | { stage: "carregando" }
  | { stage: "separando"; done: number; total: number };

export class SeparateAbort extends Error {
  constructor() {
    super("cancelado");
    this.name = "AbortError";
  }
}

/** Separa em segundo plano. `left/right` a 44,1 kHz são transferidos (deixam de valer aqui). */
export function separateStems(
  left: Float32Array,
  right: Float32Array,
  onProgress: (p: SeparateProgress) => void,
  signal?: AbortSignal,
): Promise<{ stems: Int16Array[][]; threads: number }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./separate.worker.ts", import.meta.url), { type: "module" });
    const done = () => {
      w.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      done();
      reject(new SeparateAbort());
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort);
    w.onmessage = (e: MessageEvent<SeparateResponse>) => {
      const m = e.data;
      if (m.type === "download") onProgress({ stage: "download", value: m.progress });
      else if (m.type === "stage") onProgress(m.stage === "carregando" ? { stage: "carregando" } : { stage: "separando", done: 0, total: 1 });
      else if (m.type === "progress") onProgress({ stage: "separando", done: m.done, total: m.total });
      else if (m.type === "done") {
        done();
        resolve({ stems: m.stems, threads: m.threads });
      } else {
        done();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      done();
      reject(new Error(e.message || "Falha ao iniciar a separação"));
    };
    w.postMessage({ left, right }, [left.buffer, right.buffer]);
  });
}
