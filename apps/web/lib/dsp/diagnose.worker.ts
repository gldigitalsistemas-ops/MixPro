/// <reference lib="webworker" />
import { diagnose, measureAudio, type DiagnoseContext, type Finding, type Measurements } from "./diagnose";
import type { Signal } from "./types";

export type DiagnoseRequest = { channels: Signal; sampleRate: number; context: DiagnoseContext };
export type DiagnoseResponse = { type: "done"; measurements: Measurements; findings: Finding[] } | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<DiagnoseRequest>) => {
  try {
    const m = measureAudio(e.data.channels, e.data.sampleRate);
    const res: DiagnoseResponse = { type: "done", measurements: m, findings: diagnose(m, e.data.context) };
    self.postMessage(res);
  } catch (err) {
    const res: DiagnoseResponse = { type: "error", message: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};
