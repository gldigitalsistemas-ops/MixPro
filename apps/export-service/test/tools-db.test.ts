/**
 * Ferramentas, página antes/depois e relatório contra o projeto Supabase de TESTE (nunca o de produção).
 * Lê .env.export-test na raiz (ignorado pelo git); sem o arquivo, tudo é pulado (CI). Cria usuários
 * descartáveis e apaga no fim; os ajustes de system_settings são restaurados.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SupabaseToolStore } from "../src/adapters/tool-store";
import { RpcError } from "../src/adapters/supabase-jobs";

const ENV_FILE = join(__dirname, "../../../.env.export-test");
const env: Record<string, string> = {};
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const URL_ = env.EXPORT_TEST_SUPABASE_URL ?? "";
const ANON = env.EXPORT_TEST_SUPABASE_ANON_KEY ?? "";
const SERVICE = env.EXPORT_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
const skip = !URL_ || !ANON || !SERVICE ? "sem .env.export-test (projeto de teste)" : false;
if (!skip && env.EXPORT_TEST_PROD_REF && URL_.includes(env.EXPORT_TEST_PROD_REF)) throw new Error("a URL de teste aponta para produção");

const store = new SupabaseToolStore(URL_, SERVICE);
const users: string[] = [];
const savedSettings = new Map<string, unknown>();

async function call(path: string, init: RequestInit & { key?: string; token?: string } = {}) {
  const key = init.key ?? SERVICE;
  const res = await fetch(`${URL_}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${init.token ?? key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body: body as any };
}
const rpc = (fn: string, args: Record<string, unknown>, auth?: { key?: string; token?: string }) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args), ...auth });

async function setSetting(key: string, value: unknown) {
  if (!savedSettings.has(key)) {
    const r = await call(`/rest/v1/system_settings?key=eq.${key}&select=value`);
    savedSettings.set(key, r.body[0]?.value);
  }
  const r = await call(`/rest/v1/system_settings?key=eq.${key}`, { method: "PATCH", body: JSON.stringify({ value }) });
  assert.ok(r.ok, `setting ${key}`);
}

type User = { id: string; token: string };
async function newUser(credits: number): Promise<User> {
  const email = `tools-test-${randomUUID()}@example.test`;
  const password = randomUUID();
  const c = await call("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.ok(c.ok, "criar usuário de teste");
  const id = c.body.id as string;
  users.push(id);
  const bal = await balance(id);
  if (bal !== credits) {
    const g = await rpc("grant_credits", { p_user: id, p_kind: "download", p_type: credits > bal ? "ADMIN_ADJUSTMENT" : "DOWNLOAD", p_amount: credits - bal, p_reason: "teste ferramentas", p_idempotency_key: `tools-setup:${id}` });
    assert.ok(g.ok, "ajustar saldo");
  }
  const t = await call("/auth/v1/token?grant_type=password", { method: "POST", key: ANON, body: JSON.stringify({ email, password }) });
  assert.ok(t.ok, "login de teste");
  return { id, token: t.body.access_token };
}
async function balance(id: string): Promise<number> {
  const r = await rpc("credit_balance", { p_user: id, p_kind: "download" });
  assert.ok(r.ok, "saldo");
  return r.body as number;
}
const inKey = () => `in/${randomUUID()}`;
const create = (u: User, tool: string, credits: number, inputs = 1, retention = 1) =>
  rpc("create_tool_job", { p_user: u.id, p_tool: tool, p_params: { format: "mp3", durations: Array(inputs).fill(60) }, p_inputs: Array.from({ length: inputs }, inKey), p_credits: credits, p_retention_days: retention });
const job = async (id: string) => (await call(`/rest/v1/tool_jobs?id=eq.${id}&select=*`)).body[0];
const cost = { cpu_ms: 100, rss_mb: 200, wall_ms: 300 };

before(async () => {
  if (skip) return;
  await setSetting("export_server_enabled", true);
  await setSetting("tool_user_active", 2);
  await setSetting("tool_user_per_day", 1000);
  await setSetting("tool_server_daily_jobs", 1_000_000);
});

after(async () => {
  if (skip) return;
  for (const [k, v] of savedSettings) await call(`/rest/v1/system_settings?key=eq.${k}`, { method: "PATCH", body: JSON.stringify({ value: v }) });
  for (const id of users) await call(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
});

test("(a) reserva conta exportações e ferramentas; sem saldo disponível → INSUFFICIENT_CREDITS", { skip }, async () => {
  const u = await newUser(5);
  const a = await create(u, "voice_playback", 3, 2);
  assert.ok(a.ok, JSON.stringify(a.body));
  assert.equal(a.body.credit_state, "reserved");
  const b = await create(u, "pitch_tempo", 3);
  assert.equal(b.ok, false);
  assert.match(String(b.body?.message), /INSUFFICIENT_CREDITS/);
  assert.equal(await balance(u.id), 5, "reservar não debita");
});

test("(b) entrega debita uma vez só (commit repetido é idempotente); conversão grátis não toca no saldo", { skip }, async () => {
  const u = await newUser(4);
  const c = await create(u, "pitch_tempo", 2);
  const id = c.body.job_id as string;
  assert.equal((await store.start(id, 900_000)).outcome, "started");
  await store.progress(id, 40);
  const outputs = [{ key: `out/${id}/0.mp3`, name: "musica-tom.mp3", bytes: 1000 }];
  const [r1, r2] = await Promise.all([store.commit(id, outputs, { lufs: -14 }, cost), store.commit(id, outputs, { lufs: -14 }, cost)]);
  assert.equal(r1.status, "done");
  assert.equal(r2.status, "done");
  assert.equal(await balance(u.id), 2);
  const led = (await call(`/rest/v1/credit_transactions?idempotency_key=eq.tool:${id}&select=amount`)).body;
  assert.deepEqual(led, [{ amount: -2 }]);
  const conv = await create(u, "convert", 0);
  assert.equal(conv.body.credit_state, "none");
  const cid = conv.body.job_id as string;
  await store.start(cid, 900_000);
  await store.commit(cid, [{ key: `out/${cid}/0.flac`, name: "audio.flac", bytes: 10 }], {}, cost);
  assert.equal(await balance(u.id), 2);
});

test("(c) falha libera a reserva sem debitar; saída com chave fora do padrão é recusada", { skip }, async () => {
  const u = await newUser(3);
  const c = await create(u, "reference_master", 3, 2);
  const id = c.body.job_id as string;
  await store.start(id, 900_000);
  await assert.rejects(store.commit(id, [{ key: `out/../${id}.mp3`, name: "x.mp3", bytes: 1 }], {}, cost), (e: unknown) => e instanceof RpcError && e.code === "INVALID_JOB");
  await store.release(id, "UNSUPPORTED_FORMAT", cost);
  const j = await job(id);
  assert.equal(j.status, "failed");
  assert.equal(j.credit_state, "released");
  assert.equal(await balance(u.id), 3);
  // a reserva liberada volta a valer: cabe outra de 3
  assert.ok((await create(u, "reference_master", 3, 2)).ok);
});

test("(d) separação: 1 grátis antes da primeira compra; a segunda pede compra", { skip }, async () => {
  const u = await newUser(20);
  assert.ok((await create(u, "stems", 4)).ok);
  const second = await create(u, "stems", 4);
  assert.equal(second.ok, false);
  assert.match(String(second.body?.message), /NEEDS_PURCHASE/);
});

test("(e) limite de ferramentas ao mesmo tempo → RATE_LIMITED; cancelar só o dono e libera", { skip }, async () => {
  const u = await newUser(10);
  const other = await newUser(0);
  const a = await create(u, "pitch_tempo", 2);
  await create(u, "pitch_tempo", 2);
  const third = await create(u, "pitch_tempo", 2);
  assert.match(String(third.body?.message), /RATE_LIMITED/);
  const notMine = await rpc("cancel_tool_job", { p_job_id: a.body.job_id, p_user: other.id });
  assert.match(String(notMine.body?.message), /JOB_NOT_FOUND/);
  const mine = await rpc("cancel_tool_job", { p_job_id: a.body.job_id, p_user: u.id });
  assert.equal(mine.body.cancelled, true);
  assert.equal((await job(a.body.job_id)).credit_state, "released");
  assert.ok((await create(u, "pitch_tempo", 2)).ok, "vaga liberada");
});

test("(f) o cliente não chama as RPCs nem lê a tabela; a visão mostra o próprio job sem as chaves", { skip }, async () => {
  const u = await newUser(5);
  const c = await create(u, "pitch_tempo", 2);
  const asUser = { key: ANON, token: u.token };
  for (const fn of ["create_tool_job", "start_tool_job", "commit_tool_job", "cancel_tool_job", "create_share_link", "open_share_link"]) {
    const r = await rpc(fn, {}, asUser);
    assert.ok(!r.ok, `${fn} bloqueada para o cliente`);
  }
  const direct = await call(`/rest/v1/tool_jobs?select=id`, asUser);
  assert.deepEqual(direct.ok ? direct.body : [], []);
  const view = await call(`/rest/v1/my_tool_jobs?select=*`, asUser);
  assert.ok(view.ok);
  assert.equal(view.body.length, 1);
  assert.equal(view.body[0].id, c.body.job_id);
  assert.equal("inputs" in view.body[0], false);
});

test("(g) página antes/depois: limite diário, visita contada, expirada some, com o código de indicação", { skip }, async () => {
  const u = await newUser(0);
  await setSetting("share_links_per_day", 2);
  const tok = () => randomUUID().replace(/-/g, "").slice(0, 24);
  const t1 = tok();
  assert.ok((await rpc("create_share_link", { p_user: u.id, p_token: t1, p_title: "Meu áudio", p_preset: "Voz", p_ext: "m4a", p_lufs_before: -22, p_lufs_after: -14 })).ok);
  assert.ok((await rpc("create_share_link", { p_user: u.id, p_token: tok(), p_title: "", p_preset: "", p_ext: "wav", p_lufs_before: null, p_lufs_after: null })).ok);
  const third = await rpc("create_share_link", { p_user: u.id, p_token: tok(), p_title: "", p_preset: "", p_ext: "wav", p_lufs_before: null, p_lufs_after: null });
  assert.match(String(third.body?.message), /LIMIT/);
  const open = await rpc("open_share_link", { p_token: t1 });
  assert.equal(open.body[0].title, "Meu áudio");
  assert.ok(open.body[0].referral_code, "código de indicação de quem compartilhou");
  await rpc("open_share_link", { p_token: t1 });
  assert.equal((await call(`/rest/v1/share_links?token=eq.${t1}&select=views`)).body[0].views, 2);
  await call(`/rest/v1/share_links?token=eq.${t1}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
  assert.deepEqual((await rpc("open_share_link", { p_token: t1 })).body, []);
});

test("(h) relatório PDF: 1 crédito por relatório (repetir não cobra); sem saldo recusa; grátis no Pro", { skip }, async () => {
  const u = await newUser(1);
  const asUser = { key: ANON, token: u.token };
  const ref = `rp_${randomUUID().slice(0, 8)}`;
  assert.equal((await rpc("spend_report_credit", { p_ref: ref }, asUser)).body, 0);
  assert.equal((await rpc("spend_report_credit", { p_ref: ref }, asUser)).body, 0, "mesmo relatório não cobra de novo");
  const broke = await rpc("spend_report_credit", { p_ref: `${ref}x` }, asUser);
  assert.match(String(broke.body?.message), /INSUFFICIENT_CREDITS/);
  await call(`/rest/v1/subscriptions`, { method: "POST", body: JSON.stringify({ user_id: u.id, plan_id: "pro", credits_per_cycle: 250, amount_brl: 89.9, status: "authorized", last_payment_at: new Date().toISOString() }) });
  assert.equal((await rpc("is_pro", { p_user: u.id })).body, true);
  assert.equal((await rpc("spend_report_credit", { p_ref: `${ref}y` }, asUser)).body, 0, "Pro: grátis mesmo sem saldo");
  const anon = await rpc("spend_report_credit", { p_ref: ref }, { key: ANON });
  assert.equal(anon.ok, false);
});

test("(i) planos: admin é sempre Pro; concessão com data vale até a data, depois volta e convida; só admin concede", { skip }, async () => {
  const adm = await newUser(0);
  const u = await newUser(0);
  await call(`/rest/v1/profiles?id=eq.${adm.id}`, { method: "PATCH", body: JSON.stringify({ role: "admin" }) });
  assert.equal((await rpc("is_pro", { p_user: adm.id })).body, true, "admin é Pro");
  assert.equal((await rpc("my_plan", {}, { key: ANON, token: adm.token })).body.source, "admin");
  assert.equal((await rpc("is_pro", { p_user: u.id })).body, false);

  // usuário comum não concede
  const self = await rpc("admin_set_plan", { p_user: u.id, p_plan: "pro", p_until: new Date(Date.now() + 86_400_000).toISOString() }, { key: ANON, token: u.token });
  assert.equal(self.ok, false);

  const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const g = await rpc("admin_set_plan", { p_user: u.id, p_plan: "pro", p_until: until, p_note: "cortesia" }, { key: ANON, token: adm.token });
  assert.ok(g.ok, JSON.stringify(g.body));
  assert.equal((await rpc("is_pro", { p_user: u.id })).body, true);
  const mine = (await rpc("my_plan", {}, { key: ANON, token: u.token })).body;
  assert.equal(mine.source, "grant");
  assert.equal(mine.plan, "pro");

  // data no passado é recusada
  const past = await rpc("admin_set_plan", { p_user: u.id, p_plan: "pro", p_until: new Date(Date.now() - 1000).toISOString() }, { key: ANON, token: adm.token });
  assert.match(String(past.body?.message), /INVALID/);

  // a data passou: volta ao grátis e o app recebe o convite
  await call(`/rest/v1/plan_grants?user_id=eq.${u.id}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() - 3600_000).toISOString() }) });
  assert.equal((await rpc("is_pro", { p_user: u.id })).body, false);
  const after = (await rpc("my_plan", {}, { key: ANON, token: u.token })).body;
  assert.equal(after.plan, "free");
  assert.equal(after.ended_plan, "pro");

  // remover a concessão
  await rpc("admin_set_plan", { p_user: u.id, p_plan: "pro", p_until: until }, { key: ANON, token: adm.token });
  await rpc("admin_set_plan", { p_user: u.id, p_plan: null, p_until: null }, { key: ANON, token: adm.token });
  assert.equal((await rpc("is_pro", { p_user: u.id })).body, false);
});
