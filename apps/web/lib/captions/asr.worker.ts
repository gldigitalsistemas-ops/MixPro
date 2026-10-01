/// <reference lib="webworker" />
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { Word } from "./model";

export type AsrModel = "leve" | "rapida" | "precisa";
export type AsrRequest = { audio: Float32Array; model: AsrModel; language: string; translate: boolean };
export type AsrResponse =
  | { type: "download"; progress: number }
  | { type: "progress"; value: number }
  | { type: "stage"; stage: string }
  | { type: "done"; words: Word[] }
  | { type: "error"; message: string };

const MODELS: Record<AsrModel, string> = {
  leve: "onnx-community/whisper-tiny_timestamped",
  rapida: "onnx-community/whisper-base_timestamped",
  precisa: "onnx-community/whisper-small_timestamped",
};
const SR = 16000;

env.allowLocalModels = false;

// Motor ONNX só na CPU: a versão normal (14 MB). No Safari 26 a biblioteca escolhia sozinha a versão
// "asyncify" (27 MB, feita para a placa de vídeo), que gasta muito mais memória para compilar e
// derrubava a página no iPhone ao gerar legendas. Uma thread só (sem isolamento de origem não há mais).
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number }; versions?: { web?: string } };
if (onnx?.wasm) {
  const v = onnx.versions?.web;
  if (v) {
    const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${v}/dist/ort-wasm-simd-threaded`;
    onnx.wasm.wasmPaths = { mjs: `${base}.mjs`, wasm: `${base}.wasm` };
  }
  onnx.wasm.numThreads = 1;
}

const post = (m: AsrResponse) => self.postMessage(m);

/** Corta em blocos de até 25 s, sempre no trecho mais silencioso entre 15 e 25 s. */
function splitAtSilence(x: Float32Array): { offset: number; data: Float32Array }[] {
  const frame = SR / 50;
  const out: { offset: number; data: Float32Array }[] = [];
  let start = 0;
  while (x.length - start > 25 * SR) {
    let best = start + 25 * SR;
    let bestE = Infinity;
    for (let f = start + 15 * SR; f + frame <= start + 25 * SR; f += frame) {
      let e = 0;
      for (let i = f; i < f + frame; i++) e += x[i] * x[i];
      if (e < bestE) {
        bestE = e;
        best = f + frame / 2;
      }
    }
    out.push({ offset: start / SR, data: x.subarray(start, best) });
    start = best;
  }
  out.push({ offset: start / SR, data: x.subarray(start) });
  return out;
}

/**
 * Em trecho sem fala (música, bateria, silêncio) o Whisper inventa frases de encerramento de vídeo
 * ou estica uma palavra pelo bloco inteiro.
 *  - sempre inventadas: créditos de legenda, "obrigado por assistir", "inscreva-se", reticências, ♪;
 *  - "tchau", "obrigado"… soltos: só quando são tudo o que foi reconhecido no arquivo (podem ser fala real).
 */
const ALWAYS_FAKE = /^(obrigad[oa] por assistir|inscreva-se.*|legendas? (pela|por|de) .*|.*amara\.org.*|thanks? (you )?for watching|♪+|\.+|…)[.!?…]*$/i;
const FAKE_IF_ALONE = /^(tchau|obrigad[oa]( pela atenção)?|até a próxima|thank you|you|música)[.!?…]*$/i;

function dropHallucinations(block: Word[]): Word[] {
  const text = block.map((w) => w.text).join(" ").trim();
  if (!text || ALWAYS_FAKE.test(text)) return [];
  // palavra de mais de 8 s não é fala (nota longa de canto passa: ela vem junto de outras palavras)
  return block.filter((w) => w.end - w.start <= 8 || block.length > 3);
}

let cached: { model: AsrModel; asr: Promise<AutomaticSpeechRecognitionPipeline> } | null = null;

function load(model: AsrModel) {
  if (cached?.model === model) return cached.asr;
  const files = new Map<string, { loaded: number; total: number }>();
  const asr = pipeline("automatic-speech-recognition", MODELS[model], {
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    device: "wasm",
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: "download", progress: total ? loaded / total : 0 });
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  cached = { model, asr };
  asr.catch(() => (cached = null));
  return asr;
}

self.onmessage = async (e: MessageEvent<AsrRequest>) => {
  const { audio, model, language, translate } = e.data;
  try {
    post({ type: "stage", stage: "carregando a IA" });
    const asr = await load(model);
    const parts = splitAtSilence(audio);
    const words: Word[] = [];
    post({ type: "progress", value: 0 });
    for (let i = 0; i < parts.length; i++) {
      post({ type: "stage", stage: `ouvindo o bloco ${i + 1} de ${parts.length}` });
      const { offset, data } = parts[i];
      const r = await asr(data, {
        language: language === "auto" ? undefined : language,
        // "translate" do Whisper: legenda em inglês, qualquer que seja o idioma falado
        task: translate ? "translate" : "transcribe",
        return_timestamps: "word",
      });
      const block = (r.chunks ?? []).map((c) => ({ text: c.text.trim(), start: offset + c.timestamp[0], end: offset + (c.timestamp[1] ?? c.timestamp[0] + 0.3) }));
      words.push(...dropHallucinations(block));
      post({ type: "progress", value: (i + 1) / parts.length });
    }
    const all = words.filter((w) => w.text);
    const onlyGoodbye = FAKE_IF_ALONE.test(all.map((w) => w.text).join(" ").trim());
    post({ type: "done", words: onlyGoodbye ? [] : all });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
