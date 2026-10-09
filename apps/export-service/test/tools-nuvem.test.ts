/**
 * Ferramentas de ponta a ponta com a nuvem REAL de teste (nunca a de produção):
 *   regras das rotas (createTool/startTool/toolStatus) → envio ao R2 por URL assinada → serviço
 *   (runTool) com R2Storage + SupabaseToolStore → arquivos baixados por URL assinada → crédito.
 * Precisa de .env.export-test (banco de teste), apps/web/.env.local (R2_*) e FFmpeg (FFMPEG_PATH).
 * Sem qualquer um deles, é pulado. Objetos e usuários criados são apagados no fim.
 */
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TOOL_COSTS } from "@mixpro/contracts";
import { LocalQueue } from "@/lib/export/queue";
import { R2Client, r2ConfigFromEnv } from "@/lib/export/r2";
import { createTool, startTool, toolStatus, type ToolDeps as RouteDeps } from "@/lib/tools/server-tools";
import { R2Storage } from "../src/adapters/r2-storage";
import { SupabaseToolStore } from "../src/adapters/tool-store";
import { DEFAULT_LIMITS } from "../src/pipeline";
import { runTool } from "../src/tools";

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
const SERVICE = T.EXPORT_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
if (URL_ && T.EXPORT_TEST_PROD_REF && URL_.includes(T.EXPORT_TEST_PROD_REF)) throw new Error("a URL de teste aponta para produção");
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const hasFfmpeg = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;
const r2Env = { R2_ACCOUNT_ID: W.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: W.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: W.R2_SECRET_ACCESS_KEY, R2_BUCKET: W.R2_BUCKET };
const skip = !URL_ || !SERVICE ? "sem .env.export-test" : !Object.values(r2Env).every(Boolean) ? "sem chaves do R2" : !hasFfmpeg ? "sem FFmpeg" : false;

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=representation" } });
  const text = await res.text();
  return { ok: res.ok, body: text ? JSON.parse(text) : null };
}

const users: string[] = [];
const touched: string[] = [];
const settings = new Map<string, unknown>();
const dir = skip ? "" : mkdtempSync(join(tmpdir(), "mixpro-tools-nuvem-"));

after(async () => {
  if (skip) return;
  const r2 = new R2Client(r2ConfigFromEnv(r2Env));
  for (const k of touched) await r2.delete(k).catch(() => {});
  for (const [k, v] of settings) await api(`/rest/v1/system_settings?key=eq.${k}`, { method: "PATCH", body: JSON.stringify({ value: v }) });
  for (const id of users) await api(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  rmSync(dir, { recursive: true, force: true });
});

async function setSetting(key: string, value: unknown) {
  if (!settings.has(key)) settings.set(key, (await api(`/rest/v1/system_settings?key=eq.${key}&select=value`)).body[0]?.value);
  assert.ok((await api(`/rest/v1/system_settings?key=eq.${key}`, { method: "PATCH", body: JSON.stringify({ value }) })).ok);
}

async function newUser(credits: number): Promise<string> {
  const c = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: `tools-nuvem-${randomUUID()}@example.test`, password: randomUUID(), email_confirm: true }) });
  const id = c.body.id as string;
  users.push(id);
  const bal = (await api("/rest/v1/rpc/credit_balance", { method: "POST", body: JSON.stringify({ p_user: id, p_kind: "download" }) })).body as number;
  await api("/rest/v1/rpc/grant_credits", { method: "POST", body: JSON.stringify({ p_user: id, p_kind: "download", p_type: credits > bal ? "ADMIN_ADJUSTMENT" : "DOWNLOAD", p_amount: credits - bal, p_reason: "teste", p_idempotency_key: `tn:${id}` }) });
  return id;
}
const balance = async (id: string) => (await api("/rest/v1/rpc/credit_balance", { method: "POST", body: JSON.stringify({ p_user: id, p_kind: "download" }) })).body as number;

function routeDeps(pro: boolean): RouteDeps {
  const r2 = new R2Client(r2ConfigFromEnv(r2Env));
  return {
    rpc: async (fn, args) => {
      const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
      const text = await res.text();
      const body = text ? JSON.parse(text) : null;
      return res.ok ? { data: body, error: null } : { data: null, error: { message: String(body?.message ?? res.status) } };
    },
    objects: { presign: (m, k, s, o) => r2.presign(m, k, s, o), head: (k) => r2.head(k), delete: (k) => r2.delete(k) },
    queue: new LocalQueue(),
    costs: async () => DEFAULT_TOOL_COSTS,
    isPro: async () => pro,
    stemsAvailable: () => true,
  };
}

function wav(name: string, filter: string): Buffer {
  const p = join(dir, name);
  const r = spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", filter, "-ac", "2", "-ar", "48000", p]);
  assert.equal(r.status, 0, String(r.stderr));
  return readFileSync(p);
}
function probe(file: Buffer, ext: string) {
  const p = join(dir, `${randomUUID()}.${ext}`);
  writeFileSync(p, file);
  const r = spawnSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_name,sample_fmt,bits_per_raw_sample:format=duration", "-of", "json", p]);
  return JSON.parse(String(r.stdout)) as { streams: { codec_name: string; sample_fmt?: string; bits_per_raw_sample?: string }[]; format: { duration: string } };
}

async function run(userId: string, tool: string, params: Record<string, unknown>, files: Buffer[], pro = false) {
  const d = routeDeps(pro);
  const c = await createTool(d, userId, { tool, params, inputBytes: files.map((f) => f.length) });
  assert.ok(c.ok, JSON.stringify(c));
  if (!c.ok) throw new Error();
  for (const [i, u] of c.uploads.entries()) {
    const put = await fetch(u.url, { method: "PUT", body: new Uint8Array(files[i]) });
    assert.ok(put.ok, `envio ${put.status}`);
    touched.push(new URL(u.url).pathname.split("/").slice(2).join("/"));
  }
  const s = await startTool(d, userId, c.jobId);
  assert.ok(s.ok && s.status === "queued", JSON.stringify(s));
  const r = await runTool(c.jobId, { storage: new R2Storage(r2ConfigFromEnv(r2Env)), tools: new SupabaseToolStore(URL_, SERVICE), ffmpeg: FFMPEG, ffprobe: FFPROBE, limits: { ...DEFAULT_LIMITS, maxAttempts: 1 } });
  assert.equal(r.status, "done", JSON.stringify(r));
  const st = await toolStatus(d, userId, c.jobId);
  assert.ok(st.ok && st.status === "done", JSON.stringify(st));
  if (!st.ok) throw new Error();
  const job = (await api(`/rest/v1/tool_jobs?id=eq.${c.jobId}&select=outputs,inputs`)).body[0] as { outputs: { key: string }[]; inputs: string[] };
  touched.push(...job.outputs.map((o) => o.key));
  const downloads = await Promise.all(st.outputs.map(async (o) => ({ name: o.name, data: Buffer.from(await (await fetch(o.url)).arrayBuffer()) })));
  return { jobId: c.jobId, credits: c.credits, downloads, keys: job.outputs.map((o) => o.key) };
}

test("tom +2 semitons (MP3): sobe ao R2, processa, baixa e debita 2 créditos", { skip, timeout: 180_000 }, async () => {
  await setSetting("export_server_enabled", true);
  const u = await newUser(5);
  const r = await run(u, "pitch_tempo", { semitones: 2, tempo: 1, format: "mp3", durations: [4] }, [wav("tom.wav", "sine=frequency=440:duration=4:sample_rate=48000")]);
  assert.equal(r.downloads.length, 1);
  const info = probe(r.downloads[0].data, "mp3");
  assert.equal(info.streams[0].codec_name, "mp3");
  assert.ok(Math.abs(Number(info.format.duration) - 4) < 0.3, info.format.duration);
  assert.match(r.keys[0], /^out\//);
  assert.equal(await balance(u), 3);
});

test("álbum no Pro (FLAC 24 bits): faixas + ZIP guardados no Cofre", { skip, timeout: 240_000 }, async () => {
  const u = await newUser(10);
  const files = [wav("a.wav", "sine=frequency=220:duration=3:sample_rate=48000"), wav("b.wav", "anoisesrc=d=3:c=pink:r=48000:a=0.05")];
  const r = await run(u, "album", { amount: 0.5, delivery: "social", format: "flac", durations: [3, 3] }, files, true);
  assert.equal(r.credits, 4);
  assert.ok(r.keys.every((k) => k.startsWith("cofre/")), r.keys.join(","));
  const zip = r.downloads.find((d) => d.name.endsWith(".zip"))!;
  assert.equal(zip.data.subarray(0, 2).toString(), "PK");
  const flac = r.downloads.find((d) => d.name.endsWith(".flac"))!;
  const info = probe(flac.data, "flac");
  assert.equal(info.streams[0].codec_name, "flac");
  assert.equal(info.streams[0].bits_per_raw_sample, "24");
  assert.equal(await balance(u), 6);
});
