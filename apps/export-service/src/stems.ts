/**
 * Separação de faixas no servidor: o MESMO HT-Demucs v4 (Meta, MIT) e o MESMO código do VS do app
 * (apps/web/lib/vs/demucs.ts), trocando só o motor: ONNX Runtime nativo do Node (várias threads) em vez
 * do WebAssembly do navegador. O modelo fica na imagem (STEMS_MODEL_DIR), baixado no build da versão
 * fixada do Hugging Face (webnn/stem-separator @ b56f9e6). A sessão é reaproveitada entre jobs.
 *
 * O onnxruntime-node é carregado só quando há um job de separação (e só existe na imagem do serviço):
 * os outros recursos não dependem dele.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cpus } from "node:os";
import { SR, STEMS, separate, type Stem } from "@/lib/vs/demucs";
import { resample } from "@/lib/dsp/resample";
import type { Signal } from "@/lib/dsp/types";

type Tensor = { data: Float32Array };
type Session = { run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>> };
type Ort = {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(path: string, opts: Record<string, unknown>): Promise<Session> };
};

let session: Promise<{ ort: Ort; s: Session }> | null = null;

export class StemsUnavailable extends Error {}

export function modelDir(): string {
  return process.env.STEMS_MODEL_DIR ?? "/app/models";
}

function load() {
  if (session) return session;
  session = (async () => {
    const graph = join(modelDir(), "htdemucs_fwd.onnx");
    if (!existsSync(graph) || !existsSync(`${graph}.data`)) throw new StemsUnavailable("modelo ausente");
    let ort: Ort;
    try {
      // resolve a partir do pacote em execução (na imagem: /app/node_modules)
      ort = createRequire(join(process.cwd(), "noop.js"))("onnxruntime-node") as Ort;
    } catch {
      try {
        ort = createRequire(import.meta.url)("onnxruntime-node") as Ort;
      } catch {
        throw new StemsUnavailable("motor ausente");
      }
    }
    const threads = Math.max(1, Math.min(8, Number(process.env.STEMS_THREADS) || cpus().length));
    const s = await ort.InferenceSession.create(graph, { executionProviders: ["cpu"], graphOptimizationLevel: "all", intraOpNumThreads: threads, interOpNumThreads: 1 });
    return { ort, s };
  })();
  session.catch(() => (session = null));
  return session;
}

/**
 * Separa a música em voz, bateria, baixo e outros (44,1 kHz estéreo, como o modelo foi treinado).
 * Devolve as faixas na taxa e no número de canais originais. `onProgress`: 0–1.
 */
export async function separateStems(input: Signal, sampleRate: number, onProgress?: (v: number) => void): Promise<Record<Stem, Signal>> {
  const { ort, s } = await load();
  const at44 = (c: Float32Array<ArrayBuffer>) => (sampleRate === SR ? c : resample(c, sampleRate, SR));
  const left = at44(input[0]);
  const right = input.length > 1 ? at44(input[1]) : left;
  const n = left.length;
  const out = STEMS.map(() => [new Float32Array(n), new Float32Array(n)]);
  await separate(
    left,
    right,
    async (x, xt) => {
      const r = await s.run({ x: new ort.Tensor("float32", x, [1, 4, 2048, 336]), xt: new ort.Tensor("float32", xt, [1, 2, 343980]) });
      return { x: r.x_out.data, xt: r.xt_out.data };
    },
    (stem, ch, offset, data) => out[stem][ch].set(data.subarray(0, Math.min(data.length, n - offset)), offset),
    (done, total) => onProgress?.(done / total),
  );
  const back = (c: Float32Array<ArrayBuffer>) => (sampleRate === SR ? c : resample(c, SR, sampleRate));
  const result = {} as Record<Stem, Signal>;
  STEMS.forEach((stem, k) => {
    const chs = out[k].map((c) => back(c as Float32Array<ArrayBuffer>));
    result[stem] = (input.length > 1 ? chs : [chs[0]]) as Signal;
  });
  return result;
}
