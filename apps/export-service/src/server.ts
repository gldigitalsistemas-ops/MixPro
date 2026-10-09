(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {}; // RNNoise: só carrega "na web" (window ou worker)
/**
 * Serviço de exportação de áudio (Etapa 4). HTTP mínimo:
 *   POST /run   { "job_id": "<uuid>" }  → executa o job (lido do adaptador, nunca do corpo)
 *   GET  /healthz                        → { ok, dsp_version }
 * Um job por vez por instância (no Cloud Run: concorrência 1). Respostas: 200 (done/failed —
 * falha definitiva, sem retentativa), 404, 409 (o mesmo job já está rodando), 429 (instância
 * ocupada), 503 (falha passageira: o Cloud Tasks tenta de novo).
 *
 * Jobs: no Supabase (RPCs da fatia 4) quando SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY existem; senão,
 * arquivo JSON local (fatia 3). Armazenamento: R2 quando R2_BUCKET existe (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY), senão pasta local. Variáveis (só nomes):
 *   PORT, STORAGE_DIR, JOBS_FILE, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (secreta: Secret Manager),
 *   FFMPEG_PATH, FFPROBE_PATH, EXPORT_SERVICE_TOKEN (opcional; no
 *   Cloud Run vira OIDC), NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (públicas, para o
 *   catálogo e o bucket drum-samples, só leitura).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { DSP_VERSION } from "@/lib/dsp/version";
import { RestCatalog, StaticCatalog } from "./adapters/catalog";
import { LocalJobStore } from "./adapters/jobs";
import { SupabaseJobStore } from "./adapters/supabase-jobs";
import { LocalStorage } from "./adapters/storage";
import { R2Storage } from "./adapters/r2-storage";
import { logService } from "./log";
import { DEFAULT_LIMITS, runJob, type ServiceDeps } from "./pipeline";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

export function createService(deps: ServiceDeps, token?: string): Server {
  let busy = false;
  return createServer(async (req, res) => {
    const send = (code: number, body: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true, dsp_version: DSP_VERSION });
    if (req.method !== "POST" || req.url !== "/run") return send(404, { error: "NOT_FOUND" });
    if (token && req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "UNAUTHORIZED" });
    const body = await readBody(req, 1024);
    let jobId: unknown;
    try {
      jobId = body && (JSON.parse(body) as { job_id?: unknown }).job_id;
    } catch {}
    if (typeof jobId !== "string" || !UUID.test(jobId)) return send(400, { error: "BAD_REQUEST" });
    if (busy) return send(429, { error: "BUSY" });
    busy = true;
    try {
      const r = await runJob(jobId, deps);
      send(r.http, { status: r.status, error_code: r.error_code ?? null });
    } catch {
      send(500, { error: "INTERNAL" });
    } finally {
      busy = false;
    }
  });
}

function depsFromEnv(): ServiceDeps {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return {
    storage: process.env.R2_BUCKET ? new R2Storage() : new LocalStorage(process.env.STORAGE_DIR ?? ".dados/armazenamento"),
    jobs:
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseJobStore(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
        : new LocalJobStore(process.env.JOBS_FILE ?? ".dados/jobs.json"),
    catalog: url && key ? new RestCatalog(url, key) : new StaticCatalog(),
    ffmpeg: process.env.FFMPEG_PATH ?? "ffmpeg",
    ffprobe: process.env.FFPROBE_PATH ?? "ffprobe",
    assetStorageUrl: url,
    assetMemory: new Map(),
    limits: DEFAULT_LIMITS,
  };
}

// executado direto (tsx src/server.ts ou node server.mjs): sobe o servidor
// (no pacote ESM não existe `module`: decide só pelo arquivo executado)
const isMain = /server\.(ts|mjs|js)$/.test(process.argv[1] ?? "");
if (isMain) {
  const port = Number(process.env.PORT ?? 8080);
  createService(depsFromEnv(), process.env.EXPORT_SERVICE_TOKEN || undefined).listen(port, () => logService("inicio", { porta: port, dsp_version: DSP_VERSION }));
}
