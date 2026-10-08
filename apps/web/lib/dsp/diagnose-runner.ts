"use client";

import type { DiagnoseContext, Finding, Measurements } from "./diagnose";
import type { DiagnoseRequest, DiagnoseResponse } from "./diagnose.worker";
import type { Signal } from "./types";

export type Diagnosis = {
  measurements: Measurements;
  findings: Finding[];
  /** Quanto do arquivo foi medido, em segundos (o trecho do meio quando o arquivo é longo). */
  analyzedS: number;
  totalS: number;
};

/** Trecho máximo medido: o meio do arquivo. Mantém a análise rápida e leve no celular. */
export const DIAGNOSE_MAX_S = 90;

/** Mede o áudio num Worker (sem travar a tela). Copia só o trecho analisado. */
export function runDiagnosis(channels: Signal, sampleRate: number, context: DiagnoseContext, signal?: AbortSignal): Promise<Diagnosis> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("cancelado"));
    const n = channels[0]?.length ?? 0;
    const maxLen = Math.round(sampleRate * DIAGNOSE_MAX_S);
    const from = n > maxLen ? Math.floor((n - maxLen) / 2) : 0;
    const to = Math.min(n, from + maxLen);
    const part = channels.map((c) => c.slice(from, to)) as Signal;
    const worker = new Worker(new URL("./diagnose.worker.ts", import.meta.url), { type: "module" });
    const stop = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      stop();
      reject(new Error("cancelado"));
    };
    signal?.addEventListener("abort", onAbort);
    worker.onmessage = (e: MessageEvent<DiagnoseResponse>) => {
      stop();
      if (e.data.type === "done") resolve({ measurements: e.data.measurements, findings: e.data.findings, analyzedS: (to - from) / sampleRate, totalS: n / sampleRate });
      else reject(new Error(e.data.message));
    };
    worker.onerror = (e) => {
      stop();
      reject(new Error(e.message || "Falha na análise"));
    };
    const req: DiagnoseRequest = { channels: part, sampleRate, context };
    worker.postMessage(req, part.map((c) => c.buffer));
  });
}
