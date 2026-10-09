/// <reference lib="webworker" />
import { diagnose, measureAudio, type DiagnoseContext, type Finding, type Measurements } from "./diagnose";
import type { Signal } from "./types";
import { detectBpm, detectKey } from "@/lib/tools/analysis";

export type DiagnoseRequest = { channels: Signal; sampleRate: number; context: DiagnoseContext };
export type Musical = { key: string | null; bpm: number | null };
export type DiagnoseResponse = { type: "done"; measurements: Measurements; findings: Finding[]; musical: Musical | null } | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<DiagnoseRequest>) => {
  try {
    const m = measureAudio(e.data.channels, e.data.sampleRate);
    // tom e andamento só fazem sentido em música (não em fala)
    const kind = e.data.context.kind;
    let musical: Musical | null = null;
    if (kind && kind !== "speech") {
      try {
        const key = detectKey(e.data.channels, e.data.sampleRate);
        const bpm = kind === "singing" ? null : detectBpm(e.data.channels, e.data.sampleRate);
        musical = { key: key && key.confidence > 0.05 ? key.label : null, bpm: bpm && bpm.confidence > 0.1 ? bpm.bpm : null };
      } catch {
        musical = null;
      }
    }
    const res: DiagnoseResponse = { type: "done", measurements: m, findings: diagnose(m, e.data.context), musical };
    self.postMessage(res);
  } catch (err) {
    const res: DiagnoseResponse = { type: "error", message: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};
