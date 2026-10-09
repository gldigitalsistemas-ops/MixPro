/**
 * Cliente do servidor de exportação (navegador). Fluxo:
 *   prepara só a trilha de áudio → POST /api/export/jobs (reserva o crédito) → envia direto ao R2 (PUT, com
 *   progresso real) → POST start → acompanha o status → baixa o resultado.
 * Qualquer recusa ou falha traz um código fechado, a mensagem para a pessoa e se o aparelho pode assumir
 * (`device`); o painel então processa neste aparelho, como sempre fez.
 * O navegador nunca confia nesta resposta para cobrar: o débito é feito no servidor (ou pelo
 * spend_export_credit com a mesma chave, que não cobra duas vezes).
 */
import type { ExportJob } from "@mixpro/contracts";
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, WebMOutputFormat } from "mediabunny";
import type { LoadedMedia } from "@/lib/media/load";
import { exportErrorInfo } from "./error-messages";
import { MAX_INPUT_BYTES } from "./server-limits";
import { validateServerJob } from "./server-validate";

export class ServerExportError extends Error {
  constructor(
    public code: string,
    message: string,
    /** O aparelho consegue processar este caso. */
    public device: boolean,
  ) {
    super(message);
    this.name = "ServerExportError";
  }
}

const fromCode = (code: string) => {
  const i = exportErrorInfo(code);
  return new ServerExportError(code, i.message, i.device);
};

/** Falha de rede: o servidor não foi alcançado, o aparelho assume. */
const offline = () => new ServerExportError("CAPACITY", "Sem conexão com o servidor. Vamos processar neste aparelho.", true);

export type ServerHooks = {
  onPhase: (label: string, progress: number) => void;
  signal?: AbortSignal;
  /** Injetáveis nos testes. */
  fetchFn?: typeof fetch;
  xhr?: () => XMLHttpRequest;
  sleep?: (ms: number) => Promise<void>;
  /** Tempo máximo total acompanhando o job (ms). */
  maxWaitMs?: number;
};

let enabledCache: boolean | null = null;
/** O servidor está configurado e liberado para esta conta? Em erro, não: o aparelho processa. */
export async function fetchServerExportEnabled(fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  try {
    const r = await fetchFn("/api/export/config", { cache: "no-store" });
    enabledCache = r.ok ? ((await r.json()) as { enabled?: boolean }).enabled === true : false;
  } catch {
    return false;
  }
  return enabledCache;
}
export const resetServerExportEnabled = () => {
  enabledCache = null;
};

/** O pedido cabe no servidor (mesma validação das rotas) e não leva música de fundo (ainda só no aparelho). */
export function serverEligible(job: ExportJob): boolean {
  if (job.audio.music) return false;
  return validateServerJob(JSON.stringify(job)).ok;
}

const SELF_CONTAINED = /\.(wav|mp3|ogg|flac)$/i;

/**
 * Só a trilha de áudio vai ao servidor (~1 MB por minuto): vídeo e M4A são copiados para um MP4 com o
 * índice no começo (o serviço lê em fluxo); WAV, MP3, OGG e FLAC seguem como estão.
 */
export async function prepareServerInput(media: Pick<LoadedMedia, "file" | "kind">, onProgress: (v: number) => void = () => {}): Promise<Blob> {
  const { file } = media;
  if (media.kind === "audio" && SELF_CONTAINED.test(file.name)) {
    if (file.size > MAX_INPUT_BYTES) throw fromCode("TOO_LARGE");
    return file;
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    const codec = track ? await track.getCodec() : null;
    if (!track) throw fromCode("NO_AUDIO");
    const webm = codec === "opus" || codec === "vorbis";
    const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const conversion = await Conversion.init({ input, output, tracks: "primary", video: { discard: true }, showWarnings: false });
    if (!conversion.isValid) throw fromCode("UNSUPPORTED_FORMAT");
    conversion.onProgress = onProgress;
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer) throw fromCode("INTERNAL");
    if (buffer.byteLength > MAX_INPUT_BYTES) throw fromCode("TOO_LARGE");
    return new Blob([buffer], { type: webm ? "audio/webm" : "audio/mp4" });
  } finally {
    input.dispose();
  }
}

export function put(url: string, body: Blob, onProgress: (v: number) => void, signal: AbortSignal | undefined, makeXhr: () => XMLHttpRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = makeXhr();
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort);
    const done = () => signal?.removeEventListener("abort", onAbort);
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(fromCode(xhr.status >= 500 ? "STORAGE_FAILED" : "INPUT_MISSING"));
    };
    xhr.onerror = () => {
      done();
      reject(offline());
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException("cancelado", "AbortError"));
    };
    xhr.send(body);
  });
}

export async function api<T>(fetchFn: typeof fetch, path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(path, { cache: "no-store", ...init });
  } catch {
    throw offline();
  }
  const body = (await res.json().catch(() => null)) as (T & { code?: string }) | null;
  if (!res.ok) throw fromCode(body?.code ?? (res.status === 401 ? "INVALID_JOB" : "INTERNAL"));
  return body as T;
}

/** Rótulo pela etapa REAL do serviço: 10% = decodificou; 10–90% = DSP (mix e master); depois, gravação. */
export function phaseLabel(status: string, progress: number): string {
  if (status === "queued") return "Na fila do servidor…";
  if (progress < 10) return "Analisando o áudio…";
  if (progress < 90) return "Processando o som…";
  return "Exportando o arquivo…";
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Roda o job no servidor e devolve o arquivo de áudio tratado (WAV, MP3 ou M4A conforme o alvo). */
export async function runServerExport(job: ExportJob, media: Pick<LoadedMedia, "file" | "kind">, h: ServerHooks): Promise<Blob> {
  const fetchFn = h.fetchFn ?? fetch;
  const sleep = h.sleep ?? defaultSleep;
  const throwIfAborted = () => {
    if (h.signal?.aborted) throw new DOMException("cancelado", "AbortError");
  };
  h.onPhase("Preparando o áudio…", 0);
  const input = await prepareServerInput(media, (p) => h.onPhase("Preparando o áudio…", p * 8));
  throwIfAborted();

  const created = await api<{ job_id: string; outcome: string; upload: { url: string } | null }>(fetchFn, "/api/export/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", "x-input-bytes": String(input.size) },
    body: JSON.stringify(job),
  });
  const id = created.job_id;
  const cancel = () => void fetchFn(`/api/export/jobs/${id}/cancel`, { method: "POST" }).catch(() => {});

  /** O serviço já recebeu o job (start aceito)? Antes disso, qualquer falha cancela e libera a reserva. */
  let queued = false;
  try {
    if (created.upload) {
      const makeXhr = h.xhr ?? (() => new XMLHttpRequest());
      const upload = () => put(created.upload!.url, input, (p) => h.onPhase("Enviando o áudio…", 8 + p * 12), h.signal, makeXhr);
      try {
        await upload();
      } catch (e) {
        // uma segunda tentativa só para falha de rede (a URL continua válida por 15 min)
        if (e instanceof ServerExportError && e.code === "CAPACITY") await upload();
        else throw e;
      }
    }
    throwIfAborted();
    await api(fetchFn, `/api/export/jobs/${id}/start`, { method: "POST" });
    queued = true;

    const started = Date.now();
    const maxWait = h.maxWaitMs ?? 12 * 60_000;
    for (;;) {
      throwIfAborted();
      const s = await api<{ status: string; progress: number; error_code: string | null; download_url: string | null }>(fetchFn, `/api/export/jobs/${id}`, { method: "GET" });
      if (s.status === "done" && s.download_url) {
        h.onPhase("Baixando o resultado…", 96);
        let res: Response;
        try {
          res = await fetchFn(s.download_url);
        } catch {
          throw offline();
        }
        if (!res.ok) throw fromCode("STORAGE_FAILED");
        return await res.blob();
      }
      if (s.status === "failed" || s.status === "expired") throw fromCode(s.error_code ?? "INTERNAL");
      h.onPhase(phaseLabel(s.status, s.progress), 20 + Math.min(75, Math.max(0, s.progress) * 0.75));
      if (Date.now() - started > maxWait) throw fromCode("TIMEOUT");
      await sleep(Date.now() - started > 60_000 ? 3000 : 1500);
    }
  } catch (e) {
    // cancelado pela pessoa ou falha no meio do caminho: libera a reserva e apaga o envio
    // e qualquer falha antes do serviço receber o job (envio bloqueado, fila indisponível): nada fica preso
    if (!queued || (e instanceof DOMException && e.name === "AbortError") || (e instanceof ServerExportError && e.code === "TIMEOUT")) cancel();
    throw e;
  }
}
