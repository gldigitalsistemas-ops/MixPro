/**
 * Ponta a ponta com a nuvem REAL de teste (nunca a de produção):
 *   regras das rotas (createJob/startJob/jobStatus) → R2 de verdade (URL pré-assinada) → fila →
 *   serviço (runJob) com R2Storage + SupabaseJobStore → resultado baixado por URL assinada → crédito.
 * Só falta o Cloud Tasks (a fila é a LocalQueue e o runJob é chamado direto). Precisa de:
 *   .env.export-test (banco de teste), apps/web/.env.local (R2_*) e FFmpeg (FFMPEG_PATH/FFPROBE_PATH).
 * Sem qualquer um deles, é pulado. Os objetos criados no R2 e os usuários de teste são apagados no fim.
 */
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { Signal } from "@/lib/dsp/types";
import { buildExportJob, type ExportState } from "@/lib/export/build-job";
import { decodeMedia } from "@/lib/export/ffmpeg-decode";
import { LocalQueue } from "@/lib/export/queue";
import { R2Client, r2ConfigFromEnv } from "@/lib/export/r2";
import { cancelJob, createJob, jobStatus, startJob, type Deps } from "@/lib/export/server-jobs";
import type { Look } from "@/lib/media/compose";
import { StaticCatalog } from "../src/adapters/catalog";
import { R2Storage } from "../src/adapters/r2-storage";
import { SupabaseJobStore } from "../src/adapters/supabase-jobs";
import { DEFAULT_LIMITS, runJob } from "../src/pipeline";

function readEnv(file: string) {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const T = readEnv(join(__dirname, "../../../.env.export-test"));
const W = readEnv(join(__dirname, "../../web/.env.local"));
const URL_ = T.EXPORT_TEST_SUPABASE_URL ?? "";
const ANON = T.EXPORT_TEST_SUPABASE_ANON_KEY ?? "";
const SERVICE = T.EXPORT_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL_ && T.EXPORT_TEST_PROD_REF && URL_.includes(T.EXPORT_TEST_PROD_REF)) throw new Error("a URL de teste aponta para produção");
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const hasFfmpeg = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;
const r2Env = { R2_ACCOUNT_ID: W.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: W.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: W.R2_SECRET_ACCESS_KEY, R2_BUCKET: W.R2_BUCKET };
const skip = !URL_ || !ANON || !SERVICE ? "sem .env.export-test" : !Object.values(r2Env).every(Boolean) ? "sem chaves do R2" : !hasFfmpeg ? "sem FFmpeg" : false;

async function api(path: string, init: RequestInit & { key?: string; token?: string } = {}) {
  const key = init.key ?? SERVICE;
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${init.token ?? key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) } });
  const text = await res.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

const users: string[] = [];
const touched: string[] = [];
const settings = new Map<string, unknown>();
let dir = "";

after(async () => {
  if (skip) return;
  const r2 = new R2Client(r2ConfigFromEnv(r2Env));
  for (const k of touched) await r2.delete(k).catch(() => {});
  for (const [k, v] of settings) await api(`/rest/v1/system_settings?key=eq.${k}`, { method: "PATCH", body: JSON.stringify({ value: v }) });
  for (const id of users) await api(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function setSetting(key: string, value: unknown) {
  if (!settings.has(key)) settings.set(key, (await api(`/rest/v1/system_settings?key=eq.${key}&select=value`)).body[0]?.value);
  assert.ok((await api(`/rest/v1/system_settings?key=eq.${key}`, { method: "PATCH", body: JSON.stringify({ value }) })).ok);
}
async function newUser(credits: number) {
  const email = `e2e-${randomUUID()}@example.test`;
  const c = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: randomUUID(), email_confirm: true }) });
  assert.ok(c.ok, "criar usuário");
  const id = c.body.id as string;
  users.push(id);
  const bal = (await api("/rest/v1/rpc/credit_balance", { method: "POST", body: JSON.stringify({ p_user: id, p_kind: "download" }) })).body as number;
  if (bal !== credits) await api("/rest/v1/rpc/grant_credits", { method: "POST", body: JSON.stringify({ p_user: id, p_kind: "download", p_type: credits > bal ? "ADMIN_ADJUSTMENT" : "DOWNLOAD", p_amount: credits - bal, p_reason: "e2e", p_idempotency_key: `e2e-setup:${id}` }) });
  return id;
}
const balance = async (id: string) => (await api("/rest/v1/rpc/credit_balance", { method: "POST", body: JSON.stringify({ p_user: id, p_kind: "download" }) })).body as number;
const txCount = async (id: string, ref: string) => (await api(`/rest/v1/credit_transactions?idempotency_key=eq.${encodeURIComponent(`export:${id}:${ref}`)}&select=id`)).body.length as number;

const WEB = join(__dirname, "../../web");
const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync(join(WEB, "lib/export/fixtures/chains.json"), "utf8"));
const plain: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial", color: null, cta: null };

function makeDeps(): Deps {
  const r2 = new R2Client(r2ConfigFromEnv(r2Env));
  return {
    rpc: async (fn, args) => {
      const r = await api(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
      return { data: r.ok ? r.body : null, error: r.ok ? null : { message: String(r.body?.message ?? "erro") } };
    },
    objects: { presign: (m, k, e, o) => r2.presign(m, k, e, o), head: (k) => r2.head(k), delete: (k) => r2.delete(k) },
    queue: new LocalQueue(),
  };
}

test("ponta a ponta: rotas → R2 → serviço → download, com um único débito e sem reprocessar o mesmo pedido", { skip, timeout: 240_000 }, async () => {
  dir = mkdtempSync(join(tmpdir(), "e2e-nuvem-"));
  await setSetting("export_server_enabled", true);
  await setSetting("export_user_per_hour", 1000);
  await setSetting("export_user_per_day", 1000);

  // entrada: 6 s de "voz" sintética em WAV, decodificada como o serviço decodifica
  const wavPath = join(dir, "entrada.wav");
  const gen = spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=180:duration=6:sample_rate=48000", "-f", "lavfi", "-i", "anoisesrc=d=6:c=pink:r=48000:a=0.02", "-filter_complex", "amix=inputs=2:duration=first,volume=2", "-ac", "2", wavPath]);
  assert.equal(gen.status, 0, "gerar a entrada");
  const bytes = readFileSync(wavPath);
  const dec = await decodeMedia(wavPath, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 });
  const state: ExportState = {
    target: "wav",
    media: { file: { name: "e2e.wav", size: bytes.length, lastModified: 1 }, kind: "audio", videoContainer: "mp4", sampleRate: dec.sampleRate, channels: dec.channels as Signal, audioStart: dec.audioStart, duration: dec.duration },
    preset: { slug: "criador-youtuber" },
    chainParts: { base: JSON.parse(JSON.stringify(CHAINS["criador-youtuber"])), drums: null, reverb: null, master: null },
    customizing: false, intensity: 75, denoise: 0, social: true, cutLevel: "off", segments: [{ start: dec.audioStart, end: dec.audioStart + dec.duration }],
    cutting: false, look: plain, comparing: false, audiogram: null, music: null, library: { drums: [], irs: [] }, buildId: "e2e",
  };
  const job = buildExportJob(state);
  const body = JSON.stringify(job);

  const user = await newUser(2);
  const d = makeDeps();

  // 1) rota de criação: valida, reserva e devolve a URL de envio
  const created = await createJob(d, user, { body, inputBytes: bytes.length, platform: "desktop/chrome" });
  assert.ok(created.ok, JSON.stringify(created));
  if (!created.ok || !created.upload) throw new Error("sem URL de envio");
  assert.equal(created.outcome, "created");
  const jobRow = (await api(`/rest/v1/export_jobs?id=eq.${created.jobId}&select=input_key,credit_state`)).body[0];
  touched.push(jobRow.input_key);
  assert.equal(jobRow.credit_state, "reserved");
  assert.equal(await balance(user), 2, "reservar não debita");

  // 2) início sem o arquivo: recusado
  const early = await startJob(d, user, created.jobId);
  assert.equal(!early.ok && early.code, "INPUT_MISSING");

  // 3) envio direto ao R2 pela URL assinada, como o navegador faz
  const up = await fetch(created.upload.url, { method: "PUT", body: bytes });
  assert.ok(up.ok, `PUT ${up.status}`);
  const started = await startJob(d, user, created.jobId);
  assert.ok(started.ok);

  // 4) o serviço pega o job da fila e executa (o Cloud Tasks faria este POST /run)
  const message = await d.queue.dequeue();
  assert.equal(message?.jobId, created.jobId);
  const r2s = new R2Storage(r2ConfigFromEnv(r2Env));
  const store = new SupabaseJobStore(URL_, SERVICE);
  const result = await runJob(created.jobId, { storage: r2s, jobs: store, catalog: new StaticCatalog(), ffmpeg: FFMPEG, ffprobe: FFPROBE, assetStorageUrl: "http://127.0.0.1:9", assetMemory: new Map(), limits: { ...DEFAULT_LIMITS, maxAttempts: 1 } });
  assert.deepEqual([result.http, result.status], [200, "done"], JSON.stringify(result));
  await d.queue.ack(message!.id);

  // 5) status e download por URL assinada de 60 s
  const st = await jobStatus(d, user, created.jobId);
  assert.ok(st.ok && st.status === "done" && st.creditState === "charged" && st.downloadUrl, JSON.stringify(st));
  if (!st.ok || !st.downloadUrl) return;
  const done = (await api(`/rest/v1/export_jobs?id=eq.${created.jobId}&select=output_key,job_text,lufs`)).body[0];
  touched.push(done.output_key);
  assert.equal(done.job_text, null, "o JSON do job é apagado quando termina");
  const out = Buffer.from(await (await fetch(st.downloadUrl)).arrayBuffer());
  assert.equal(out.subarray(0, 4).toString(), "RIFF");
  assert.equal(out.subarray(8, 12).toString(), "WAVE");
  assert.ok(Math.abs(Number(done.lufs) - -14) < 1, `LUFS ${done.lufs}`);
  const anon = await fetch(`https://${r2Env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${r2Env.R2_BUCKET}/${done.output_key}`);
  assert.ok([400, 401, 403].includes(anon.status), "o resultado não é público");

  // 6) crédito: debitado uma vez, e o spend do app com a mesma chave não cobra de novo
  assert.equal(await balance(user), 1);
  assert.equal(await txCount(user, job.idempotency_ref), 1);
  const again = await api("/rest/v1/rpc/spend_export_credit", { method: "POST", body: JSON.stringify({ p_ref: job.idempotency_ref, p_kind: "audio" }), key: ANON, token: undefined });
  void again; // sem a sessão do usuário o PostgREST recusa; a idempotência da chave é testada em supabase.test.ts

  // 7) o mesmo pedido de novo: reaproveita o job pronto, sem novo envio nem novo débito
  const repeat = await createJob(d, user, { body, inputBytes: bytes.length });
  assert.ok(repeat.ok && repeat.outcome === "done" && repeat.upload === null && repeat.jobId === created.jobId);
  assert.equal(await balance(user), 1);

  // 8) outro usuário não enxerga nem baixa o resultado
  const other = await newUser(1);
  const peek = await jobStatus(d, other, created.jobId);
  assert.equal(!peek.ok && peek.code, "JOB_NOT_FOUND");
});

test("cancelar um job na fila libera a reserva e apaga o arquivo enviado", { skip, timeout: 120_000 }, async () => {
  await setSetting("export_server_enabled", true);
  const user = await newUser(1);
  const d = makeDeps();
  const ch = new Float32Array(48000).map((_, i) => Math.sin(i / 20) * 0.2);
  const job = buildExportJob({
    target: "wav",
    media: { file: { name: "c.wav", size: 5000, lastModified: 2 }, kind: "audio", videoContainer: "mp4", sampleRate: 48000, channels: [ch], audioStart: 0, duration: 1 },
    preset: { slug: "criador-youtuber" },
    chainParts: { base: JSON.parse(JSON.stringify(CHAINS["criador-youtuber"])), drums: null, reverb: null, master: null },
    customizing: false, intensity: 75, denoise: 0, social: true, cutLevel: "off", segments: [{ start: 0, end: 1 }], cutting: false, look: plain, comparing: false, audiogram: null, music: null, library: { drums: [], irs: [] }, buildId: "e2e",
  });
  const created = await createJob(d, user, { body: JSON.stringify(job), inputBytes: 5000 });
  assert.ok(created.ok && created.upload);
  if (!created.ok || !created.upload) return;
  const key = (await api(`/rest/v1/export_jobs?id=eq.${created.jobId}&select=input_key`)).body[0].input_key as string;
  touched.push(key);
  assert.ok((await fetch(created.upload.url, { method: "PUT", body: new Uint8Array(5000) })).ok);
  assert.ok(await new R2Client(r2ConfigFromEnv(r2Env)).head(key));
  assert.ok((await cancelJob(d, user, created.jobId)).ok);
  assert.equal(await new R2Client(r2ConfigFromEnv(r2Env)).head(key), null, "arquivo enviado apagado");
  assert.equal(await balance(user), 1, "nenhum crédito usado");
  const s = await jobStatus(d, user, created.jobId);
  assert.ok(s.ok && s.errorCode === "CANCELLED");
});
