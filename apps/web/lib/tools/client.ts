/**
 * Cliente das ferramentas no navegador: mede a duração de cada arquivo (o preço depende dela), envia
 * direto ao R2 com progresso real, inicia, acompanha o andamento real e devolve os arquivos prontos.
 * De vídeos, só a trilha de áudio sobe (a imagem nunca sai do aparelho).
 */
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import type { ToolId } from "@mixpro/contracts";
import { prepareServerInput, put } from "@/lib/export/server-client";

export class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

const GENERIC = "Não conseguimos processar agora. Tente de novo em alguns minutos; nenhum crédito foi usado.";

/** Duração em segundos (mediabunny; se o navegador não abrir o formato, o elemento de áudio). */
export async function fileDuration(file: Blob): Promise<number | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const d = await input.computeDuration();
    if (Number.isFinite(d) && d > 0) return d;
  } catch {
    // tenta pelo elemento de áudio
  } finally {
    input.dispose();
  }
  if (typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("audio");
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

/** O que sobe para o servidor: de vídeo, só a trilha de áudio; áudio vai como está. */
export async function toolUpload(file: File): Promise<Blob> {
  return file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name) ? prepareServerInput({ file, kind: "video" }) : file;
}

export type ToolHooks = {
  onPhase: (label: string, progress: number) => void;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  xhr?: () => XMLHttpRequest;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
};

export type ToolResult = { jobId: string; credits: number; outputs: { name: string; bytes: number; url: string }[]; measures: Record<string, unknown> | null; expiresAt: string };

async function call<T>(fetchFn: typeof fetch, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(path, { cache: "no-store", ...init });
  } catch {
    throw new ToolError("OFFLINE", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) throw new ToolError(body?.code ?? "INTERNAL", body?.error ?? GENERIC);
  return body as T;
}

const STAGES: Record<ToolId, string> = {
  pitch_tempo: "Mudando o tom e o andamento…",
  voice_playback: "Mixando a voz com o playback…",
  reference_master: "Masterizando pela referência…",
  album: "Masterizando as faixas…",
  stems: "Separando as faixas…",
  convert: "Convertendo o arquivo…",
};

/**
 * Roda uma ferramenta de ponta a ponta. `files` já são os blobs a enviar (use toolUpload);
 * `params` já traz as durações. Falha antes de o serviço receber o job: cancela e libera os créditos.
 */
export async function runToolJob(tool: ToolId, params: Record<string, unknown>, files: Blob[], h: ToolHooks): Promise<ToolResult> {
  const fetchFn = h.fetchFn ?? fetch;
  const sleep = h.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const aborted = () => {
    if (h.signal?.aborted) throw new DOMException("cancelado", "AbortError");
  };
  h.onPhase("Preparando…", 0);
  const created = await call<{ job_id: string; credits: number; uploads: { url: string }[] }>(fetchFn, "/api/tools/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, params, input_bytes: files.map((f) => f.size) }),
  });
  const id = created.job_id;
  const cancel = () => void fetchFn(`/api/tools/jobs/${id}/cancel`, { method: "POST" }).catch(() => {});
  let queued = false;
  try {
    const total = files.reduce((a, f) => a + f.size, 0) || 1;
    let sent = 0;
    const makeXhr = h.xhr ?? (() => new XMLHttpRequest());
    for (let i = 0; i < files.length; i++) {
      aborted();
      const before = sent;
      await put(created.uploads[i].url, files[i], (p) => h.onPhase(files.length > 1 ? `Enviando os arquivos (${i + 1} de ${files.length})…` : "Enviando o arquivo…", 2 + ((before + p * files[i].size) / total) * 18), h.signal, makeXhr).catch((e) => {
        if (e instanceof DOMException) throw e;
        throw new ToolError("UPLOAD", "O envio não foi concluído. Verifique a internet e tente de novo; nenhum crédito foi usado.");
      });
      sent += files[i].size;
    }
    aborted();
    await call(fetchFn, `/api/tools/jobs/${id}/start`, { method: "POST" });
    queued = true;
    const started = Date.now();
    const maxWait = h.maxWaitMs ?? 32 * 60_000;
    for (;;) {
      aborted();
      const s = await call<{ status: string; progress: number; message: string | null; errorCode: string | null; outputs: ToolResult["outputs"]; measures: ToolResult["measures"]; credits: number; expiresAt: string }>(fetchFn, `/api/tools/jobs/${id}`);
      if (s.status === "done") return { jobId: id, credits: s.credits, outputs: s.outputs, measures: s.measures, expiresAt: s.expiresAt };
      if (s.status === "failed" || s.status === "expired") throw new ToolError(s.errorCode ?? "INTERNAL", s.message ?? GENERIC);
      h.onPhase(s.status === "queued" ? "Na fila do servidor…" : s.progress < 15 ? "Lendo os arquivos…" : s.progress >= 85 ? "Gravando os arquivos…" : STAGES[tool], 20 + Math.min(78, Math.max(0, s.progress) * 0.78));
      if (Date.now() - started > maxWait) throw new ToolError("TIMEOUT", "Está demorando mais que o normal. Veja o resultado depois em Meus projetos.");
      await sleep(Date.now() - started > 60_000 ? 3000 : 1500);
    }
  } catch (e) {
    if (!queued || (e instanceof DOMException && e.name === "AbortError")) cancel();
    throw e;
  }
}
