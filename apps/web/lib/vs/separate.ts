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
 * guardada antes desta página ser isolada (sem o cabeçalho COEP) é recusada aqui e o worker nem abre.
 * Por isso o endereço real do arquivo é anotado ao criar o worker; se ele não abrir, a segunda
 * tentativa usa o mesmo endereço com "?r=…" — outro endereço para o navegador, que então busca no
 * servidor (com os cabeçalhos atuais) em vez do cache.
 */
let workerUrl: string | null = null;
let workerOpts: WorkerOptions | undefined;

function createWorker(bust?: string): Worker {
  if (bust && workerUrl) {
    const u = new URL(workerUrl, location.href);
    u.searchParams.set("r", bust);
    return new Worker(u.toString(), workerOpts);
  }
  const Native = globalThis.Worker;
  // anota o endereço que o empacotador gera para o worker (ele chama o Worker global)
  globalThis.Worker = class extends Native {
    constructor(url: string | URL, opts?: WorkerOptions) {
      workerUrl = String(url);
      workerOpts = opts;
      super(url, opts);
    }
  };
  try {
    return new Worker(new URL("./separate.worker.ts", import.meta.url), { type: "module" });
  } finally {
    globalThis.Worker = Native;
  }
}

/** O que o servidor entrega para o arquivo do worker (vai junto no registro de erro). */
async function probeWorkerScript(): Promise<string> {
  if (!workerUrl) return "endereço do worker desconhecido";
  try {
    const res = await fetch(new URL(workerUrl, location.href).toString().split("#")[0], { cache: "no-store" });
    return `worker ${res.status} coep=${res.headers.get("cross-origin-embedder-policy") ?? "-"} corp=${res.headers.get("cross-origin-resource-policy") ?? "-"} isolada=${self.crossOriginIsolated}`;
  } catch (err) {
    return `worker inacessível: ${(err as Error).message}`;
  }
}

/** Separa em segundo plano. `left/right` a 44,1 kHz são transferidos (deixam de valer aqui). */
export async function separateStems(
  left: Float32Array,
  right: Float32Array,
  onProgress: (p: SeparateProgress) => void,
  signal?: AbortSignal,
): Promise<{ stems: Int16Array[][]; threads: number }> {
  let w = await openWorker();
  // o worker nem abriu (cópia antiga no cache): tenta de novo buscando no servidor
  if (!w) w = await openWorker(Date.now().toString(36));
  if (!w) throw new Error(`Falha ao iniciar a separação (worker não abriu nem buscando no servidor) — ${await probeWorkerScript()}`);
  return run(w, left, right, onProgress, signal);
}

/** Cria o worker e espera ele avisar que abriu (null se não abrir). */
function openWorker(bust?: string): Promise<Worker | null> {
  return new Promise((resolve) => {
    let w: Worker;
    try {
      w = createWorker(bust);
    } catch {
      return resolve(null);
    }
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
