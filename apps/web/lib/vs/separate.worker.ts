/// <reference lib="webworker" />
/**
 * Separação das pistas do VS em segundo plano (HT-Demucs v4, MIT, via ONNX Runtime na CPU).
 * O modelo (~170 MB) é baixado uma vez e fica guardado no aparelho (Cache Storage).
 * As pistas voltam em 16 bits (metade da memória de float), bloco a bloco.
 */
import * as ort from "onnxruntime-web/wasm";
import { STEMS, separate } from "./demucs";

export type SeparateRequest = { left: Float32Array; right: Float32Array };
export type SeparateResponse =
  | { type: "download"; progress: number }
  | { type: "stage"; stage: "carregando" | "separando" }
  | { type: "progress"; done: number; total: number }
  | { type: "done"; stems: Int16Array[][]; threads: number }
  | { type: "error"; message: string };

const REPO = "https://huggingface.co/webnn/stem-separator/resolve/b56f9e66ceffca2401f83d2469dadaddd06e4994/onnx";
const FILES = { graph: `${REPO}/htdemucs_fwd.onnx`, weights: `${REPO}/htdemucs_fwd.onnx.data` };
const CACHE = "mixpro-vs-model-v1";
const SIZES = { graph: 2_385_507, weights: 168_361_984 };

const post = (m: SeparateResponse, transfer: Transferable[] = []) => self.postMessage(m, transfer);

/** Baixa (ou lê do aparelho) um arquivo do modelo, informando o progresso. */
async function fetchCached(url: string, size: number, onBytes: (n: number) => void): Promise<Uint8Array> {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) {
    const b = new Uint8Array(await hit.arrayBuffer());
    onBytes(b.length);
    return b;
  }
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar a IA de separação (${res.status})`);
  // um ramo vai para o aparelho (cache), o outro para a memória: sem uma segunda cópia de 168 MB
  const [toCache, toMemory] = res.body.tee();
  const saving = cache?.put(url, new Response(toCache, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  const out = new Uint8Array(Number(res.headers.get("content-length")) || size);
  const reader = toMemory.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, n);
    n += value.length;
    onBytes(value.length);
  }
  await saving;
  return out.subarray(0, n);
}

let session: Promise<ort.InferenceSession> | null = null;

function load() {
  if (session) return session;
  session = (async () => {
    // motor da CPU normal (14 MB); com isolamento de origem a página permite várias threads
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    const total = SIZES.graph + SIZES.weights;
    let got = 0;
    const tick = (b: number) => {
      got += b;
      post({ type: "download", progress: Math.min(1, got / total) });
    };
    const [graph, weights] = await Promise.all([fetchCached(FILES.graph, SIZES.graph, tick), fetchCached(FILES.weights, SIZES.weights, tick)]);
    post({ type: "stage", stage: "carregando" });
    return ort.InferenceSession.create(graph, {
      executionProviders: ["wasm"],
      externalData: [{ path: "htdemucs_fwd.onnx.data", data: weights }],
      graphOptimizationLevel: "all",
    });
  })();
  session.catch(() => (session = null));
  return session;
}

self.onmessage = async (e: MessageEvent<SeparateRequest>) => {
  try {
    const { left, right } = e.data;
    const s = await load();
    post({ type: "stage", stage: "separando" });
    const n = left.length;
    const stems = STEMS.map(() => [new Int16Array(n), new Int16Array(n)]);
    await separate(
      left,
      right,
      async (x, xt) => {
        const r = await s.run({
          x: new ort.Tensor("float32", x, [1, 4, 2048, 336]),
          xt: new ort.Tensor("float32", xt, [1, 2, 343980]),
        });
        return { x: r.x_out.data as Float32Array, xt: r.xt_out.data as Float32Array };
      },
      (stem, ch, offset, data) => {
        const dst = stems[stem][ch];
        for (let i = 0; i < data.length; i++) {
          const v = data[i] * 32767;
          dst[offset + i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
        }
      },
      (done, total) => post({ type: "progress", done, total }),
    );
    post({ type: "done", stems, threads: ort.env.wasm.numThreads as number }, stems.flat().map((a) => a.buffer));
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
