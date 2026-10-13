/**
 * Mix & Master IA de ponta a ponta com a nuvem REAL de teste: regras das rotas (createProject/startPreview/
 * checkout em créditos/projectStatus) → envio ao Cofre do projeto no R2 por URL assinada → serviço (runTool)
 * com R2Storage + SupabaseToolStore → arquivos por URL assinada. Precisa de .env.export-test,
 * apps/web/.env.local (R2_*) e FFmpeg. Objetos e usuários criados são apagados no fim.
 */
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePremium } from "@mixpro/contracts";
import { LocalQueue } from "@/lib/export/queue";
import { R2Client, r2ConfigFromEnv } from "@/lib/export/r2";
import { createProject, projectStatus, startPreview, type PremiumDeps, type Project } from "@/lib/premium/server";
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
const hasFfmpeg = spawnSync(FFMPEG, ["-version"]).status === 0;
const r2Env = { R2_ACCOUNT_ID: W.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: W.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: W.R2_SECRET_ACCESS_KEY, R2_BUCKET: W.R2_BUCKET };
const skip = !URL_ || !SERVICE ? "sem .env.export-test" : !Object.values(r2Env).every(Boolean) ? "sem chaves do R2" : !hasFfmpeg ? "sem FFmpeg" : false;

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=representation" };
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: H });
  const text = await res.text();
  return { ok: res.ok, body: text ? JSON.parse(text) : null };
}
const users: string[] = [];
const touched: string[] = [];
const dir = skip ? "" : mkdtempSync(join(tmpdir(), "mixpro-premium-nuvem-"));

after(async () => {
  if (skip) return;
  const r2 = new R2Client(r2ConfigFromEnv(r2Env));
  for (const k of touched) await r2.delete(k).catch(() => {});
  for (const id of users) await api(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  rmSync(dir, { recursive: true, force: true });
});

function deps(): PremiumDeps {
  const r2 = new R2Client(r2ConfigFromEnv(r2Env));
  return {
    rpc: async (fn, args) => {
      const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) });
      const t = await r.text();
      const b = t ? JSON.parse(t) : null;
      return r.ok ? { data: b, error: null } : { data: null, error: { message: String(b?.message ?? r.status) } };
    },
    objects: { presign: (m, k, s, o) => r2.presign(m, k, s, o), head: (k) => r2.head(k), delete: (k) => r2.delete(k), copy: async () => {} },
    queue: new LocalQueue(),
    catalog: async () => parsePremium(null),
    isPro: async () => false,
    projects: {
      get: async (id) => ((await api(`/rest/v1/premium_projects?id=eq.${id}&select=*`)).body[0] as Project) ?? null,
      insert: async (p) => {
        const r = await api("/rest/v1/premium_projects", { method: "POST", body: JSON.stringify(p) });
        assert.ok(r.ok, JSON.stringify(r.body));
      },
      update: async (id, patch) => void (await api(`/rest/v1/premium_projects?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) })),
    },
    orders: { get: async (id) => (await api(`/rest/v1/premium_orders?id=eq.${id}&select=*`)).body[0] ?? null },
    previewsToday: async () => 0,
    previewLimit: async () => 6,
    introUsed: async () => false,
    checkout: async () => ({ initPoint: "https://mp.test" }),
    introSecret: () => "segredo-teste",
    heavyAvailable: () => false,
  };
}

function wav(filter: string): Uint8Array {
  const f = join(dir, `${randomUUID()}.wav`);
  assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", filter, f]).status, 0);
  return new Uint8Array(readFileSync(f));
}

test("Mix & Master IA na nuvem: cria, envia ao Cofre do projeto, prévia processada no serviço e baixada", { skip, timeout: 300_000 }, async () => {
  const c = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: `prem-nuvem-${randomUUID()}@example.test`, password: randomUUID(), email_confirm: true }) });
  const uid = c.body.id as string;
  users.push(uid);
  const d = deps();
  const files = [wav("aevalsrc='0.2*sin(2*PI*446*t)*lt(mod(t,2),1.5)':s=48000:d=35"), wav("aevalsrc='0.8*sin(2*PI*58*mod(t,0.5))*exp(-mod(t,0.5)*18)':s=48000:d=35")];
  const r = await createProject(d, uid, { product: "mix_ia", files: [{ name: "Voz.wav", bytes: files[0].byteLength }, { name: "Kick.wav", bytes: files[1].byteLength }] });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  for (const [i, u] of r.uploads.entries()) {
    const put = await fetch(u, { method: "PUT", body: files[i] as BodyInit });
    assert.ok(put.ok, `envio ${put.status}`);
    touched.push(`cofre/proj/${r.projectId}/${String(i).padStart(2, "0")}`);
  }
  const t = (name: string, role: string) => ({ name, role, gain_db: 0, pan: null, mute: false, eq_low: 0, eq_mid: 0, eq_high: 0, comp: null, reverb: null, tune: role === "lead_vocal" ? 50 : 0 });
  const pv = await startPreview(d, uid, r.projectId, { format: "wav", durations: [35, 35], has_reference: false, ref_amount: 0.6, genre: "pop", align: false, tracks: [t("Voz.wav", "lead_vocal"), t("Kick.wav", "kick")], master_chain: null, master_name: null, target_lufs: -10 });
  assert.ok(pv.ok, JSON.stringify(pv));
  if (!pv.ok) return;
  const run = await runTool(pv.jobId, { storage: new R2Storage(r2ConfigFromEnv(r2Env)), tools: new SupabaseToolStore(URL_, SERVICE), ffmpeg: FFMPEG, ffprobe: FFPROBE, limits: { ...DEFAULT_LIMITS, maxAttempts: 1 } });
  assert.equal(run.status, "done", JSON.stringify(run));
  const st = await projectStatus(d, uid, r.projectId);
  assert.ok(st.ok);
  if (!("project" in st)) return;
  assert.equal(st.project.status, "preview");
  assert.equal(st.preview?.status, "done");
  const names = st.preview!.outputs.map((o) => o.name);
  assert.ok(names.includes("previa-mix.mp3") && names.includes("vitrine-depois.m4a") && names.filter((n) => n.startsWith("mixer-")).length === 2, names.join(","));
  const job = (await api(`/rest/v1/tool_jobs?id=eq.${pv.jobId}&select=outputs`)).body[0];
  touched.push(...job.outputs.map((o: { key: string }) => o.key));
  const mp3 = await fetch(st.preview!.outputs.find((o) => o.name === "previa-mix.mp3")!.url);
  assert.ok(mp3.ok && (await mp3.arrayBuffer()).byteLength > 100_000, "prévia baixada");
  // sem pagamento, o trabalho final não começa
  const st2 = await projectStatus(d, uid, r.projectId);
  assert.ok("project" in st2 && !st2.final);
});
