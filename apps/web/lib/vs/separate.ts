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

/**
 * O arquivo de partida dos workers tem nome fixo e fica no cache do navegador por 1 ano. Uma cópia
 * guardada antes desta página ser isolada (sem o cabeçalho COEP) é recusada aqui e o worker nem
 * abre. Baixa de novo esses arquivos, ignorando o cache, para tentar outra vez.
 */
async function refreshWorkerScripts() {
  const urls = new Set(
    performance
      .getEntriesByType("resource")
      .map((e) => e.name.split("#")[0])
      .filter((u) => u.startsWith(location.origin) && /\/_next\/static\/.*worker.*\.js/.test(u)),
  );
  await Promise.all([...urls].map((u) => fetch(u, { cache: "reload" }).catch(() => {})));
  return urls.size;
}

/** Separa em segundo plano. `left/right` a 44,1 kHz são transferidos (deixam de valer aqui). */
export async function separateStems(
  left: Float32Array,
  right: Float32Array,
  onProgress: (p: SeparateProgress) => void,
  signal?: AbortSignal,
): Promise<{ stems: Int16Array[][]; threads: number }> {
  let w = await openWorker();
  if (!w) {
    // o worker nem abriu (cópia antiga no cache): renova os arquivos e tenta uma vez
    await refreshWorkerScripts();
    w = await openWorker();
    if (!w) throw new Error("Falha ao iniciar a separação (worker não abriu mesmo depois de renovar o cache)");
  }
  return run(w, left, right, onProgress, signal);
}

/** Cria o worker e espera ele avisar que abriu (null se não abrir). */
function openWorker(): Promise<Worker | null> {
  return new Promise((resolve) => {
    const w = new Worker(new URL("./separate.worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => fail(), 60_000);
    const fail = () => {
      clearTimeout(timer);
      w.terminate();
      resolve(null);
    };
    w.onerror = fail;
    w.onmessage = (e: MessageEvent<SeparateResponse>) => {
      if (e.data.type !== "ready") return;
      clearTimeout(timer);
      w.onerror = null;
      w.onmessage = null;
      resolve(w);
    };
  });
}

function run(
  w: Worker,
  left: Float32Array,
  right: Float32Array,
  onProgress: (p: SeparateProgress) => void,
  signal?: AbortSignal,
): Promise<{ stems: Int16Array[][]; threads: number }> {
  return new Promise((resolve, reject) => {
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
      } else if (m.type === "error") {
        done();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      done();
      reject(new Error(e.message || "Falha na separação (o worker parou)"));
    };
    w.postMessage({ left, right }, [left.buffer, right.buffer]);
  });
}
