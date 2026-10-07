/**
 * Fatia 4: banco e crédito contra o projeto Supabase de TESTE (nunca o de produção).
 * Lê .env.export-test na raiz do repositório (ignorado pelo git):
 *   EXPORT_TEST_SUPABASE_URL, EXPORT_TEST_SUPABASE_ANON_KEY, EXPORT_TEST_SUPABASE_SERVICE_ROLE_KEY
 *   EXPORT_TEST_PROD_REF (opcional: ref do projeto de produção; se a URL o contiver, os testes param)
 * Sem o arquivo, tudo é pulado (CI). Cria usuários descartáveis e apaga no fim. Os ajustes de
 * system_settings são restaurados no fim.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SupabaseJobStore, RpcError } from "../src/adapters/supabase-jobs";
import { JobError } from "../src/errors";
import type { JobCost, JobMeasures } from "../src/adapters/jobs";

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

const store = new SupabaseJobStore(URL_, SERVICE);
const users: string[] = [];
const savedSettings = new Map<string, unknown>();

// ---------------------------------------------------------------- HTTP

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
const rpc = (fn: string, args: Record<string, unknown>, auth?: { key?: string; token?: string }) =>
  call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args), ...auth });

async function setSetting(key: string, value: unknown) {
  if (!savedSettings.has(key)) {
    const r = await call(`/rest/v1/system_settings?key=eq.${key}&select=value`);
    savedSettings.set(key, r.body[0]?.value);
  }
  const r = await call(`/rest/v1/system_settings?key=eq.${key}`, { method: "PATCH", body: JSON.stringify({ value }) });
  assert.ok(r.ok, `setting ${key}`);
}

// ---------------------------------------------------------------- usuários e créditos

type User = { id: string; token: string };
async function newUser(credits: number): Promise<User> {
  const email = `export-test-${randomUUID()}@example.test`;
  const password = randomUUID();
  const c = await call("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.ok(c.ok, "criar usuário de teste");
  const id = c.body.id as string;
  users.push(id);
  // zera os downloads grátis do cadastro e deixa exatamente `credits`
  const bal = await balance(id);
  if (bal !== credits) {
    const g = await rpc("grant_credits", { p_user: id, p_kind: "download", p_type: credits > bal ? "ADMIN_ADJUSTMENT" : "DOWNLOAD", p_amount: credits - bal, p_reason: "teste fatia 4", p_idempotency_key: `test-setup:${id}` });
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
async function ledger(id: string, ref: string) {
  const r = await call(`/rest/v1/credit_transactions?idempotency_key=eq.${encodeURIComponent(`export:${id}:${ref}`)}&select=id,amount`);
  return r.body as { id: string; amount: number }[];
}
async function row(jobId: string) {
  const r = await call(`/rest/v1/export_jobs?id=eq.${jobId}&select=*`);
  return r.body[0];
}

// ---------------------------------------------------------------- job

const ref = () => `t${randomUUID().replace(/-/g, "")}`;
const jobText = JSON.stringify({ version: 1, source: { duration_s: 10, sample_rate: 48000, channels: 1, audio_start_s: 0 }, target: "wav" });
const measures = (fp: string): JobMeasures => ({
  duration_s: 10, samples: 480000, channels: 1, sample_rate: 48000, lufs: -14, peak: -1, sha256_f32: "0".repeat(64), content_fingerprint: fp, output_bytes: 1000,
  input_duration_s: 10.02, input_samples: 481000, input_audio_start_s: 0, input_sample_rate: 48000,
});
const cost: JobCost = { cpu_ms: 1200, rss_mb: 300, wall_ms: 1500, etapas_ms: { decode: 100 } };
const outKey = () => `out/${randomUUID()}.wav`;

async function create(u: User, r: string) {
  return store.create({ user_id: u.id, idempotency_ref: r, target: "wav", job_json: jobText, input_key: `in/${randomUUID()}`, platform: "desktop/chrome" });
}
/** create → start → commit (o caminho feliz do pipeline). */
async function runToCommit(u: User, r: string, fp = "abcdef01") {
  const c = await create(u, r);
  const s = await store.start(c.job_id, 900_000);
  assert.equal(s.outcome, "started");
  return { c, rec: await store.commit(c.job_id, { output_key: outKey(), measures: measures(fp), cost }) };
}

// ---------------------------------------------------------------- ciclo

before(async () => {
  if (skip) return;
  await setSetting("export_server_enabled", true);
  await setSetting("export_user_active", 1);
  await setSetting("export_user_per_hour", 1000);
  await setSetting("export_user_per_day", 1000);
  await setSetting("export_server_daily_cpu_s", 10_000_000);
  await setSetting("export_server_daily_jobs", 10_000_000);
});

after(async () => {
  if (skip) return;
  for (const [k, v] of savedSettings) await call(`/rest/v1/system_settings?key=eq.${k}`, { method: "PATCH", body: JSON.stringify({ value: v }) });
  for (const id of users) await call(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
});

// ---------------------------------------------------------------- casos

test("(a) dois create simultâneos com o mesmo p_ref → o mesmo job, uma reserva", { skip }, async () => {
  const u = await newUser(1);
  const r = ref();
  const [x, y] = await Promise.all([create(u, r), create(u, r)]);
  assert.equal(x.job_id, y.job_id);
  assert.deepEqual([x.outcome, y.outcome].sort(), ["created", "existing"]);
  const jobs = await call(`/rest/v1/export_jobs?user_id=eq.${u.id}&credit_state=eq.reserved&select=id`);
  assert.equal(jobs.body.length, 1);
  assert.equal(await balance(u.id), 1, "reservar não debita");
});

test("(b) p_ref já pago no aparelho → charged sem cobrar; pago no servidor → done reaproveitado", { skip }, async () => {
  const u = await newUser(2);
  const r1 = ref();
  const spend = await rpc("spend_export_credit", { p_ref: r1, p_kind: "audio" }, { key: ANON, token: u.token });
  assert.ok(spend.ok);
  assert.equal(await balance(u.id), 1);
  const c = await create(u, r1);
  assert.equal(c.credit_state, "charged");
  await store.start(c.job_id, 900_000);
  await store.commit(c.job_id, { output_key: outKey(), measures: measures("11111111"), cost });
  assert.equal(await balance(u.id), 1, "não cobrou de novo");
  assert.equal((await ledger(u.id, r1)).length, 1);

  // pago no servidor: novo pedido com o mesmo p_ref devolve o job pronto
  const again = await create(u, r1);
  assert.equal(again.outcome, "done");
  assert.equal(again.job_id, c.job_id);
  assert.equal(await balance(u.id), 1);
});

test("(c) falha antes do débito → reserva liberada, saldo intacto", { skip }, async () => {
  const u = await newUser(1);
  const c = await create(u, ref());
  await store.start(c.job_id, 900_000);
  const rec = await store.release(c.job_id, "CORRUPT_INPUT", cost, { input_duration_s: 9.5, input_samples: 456000, input_audio_start_s: 0, input_sample_rate: 48000 });
  assert.equal(rec?.status, "failed");
  assert.equal(rec?.credit_state, "released");
  assert.equal(rec?.job_json, null);
  assert.equal(await balance(u.id), 1);
  const full = await row(c.job_id);
  assert.equal(full.diff_duration_ms, -500, "telemetria de divergência gravada");
});

test("(d) commit repetido (inclusive em paralelo) → uma cobrança só", { skip }, async () => {
  const u = await newUser(3);
  const r = ref();
  const c = await create(u, r);
  await store.start(c.job_id, 900_000);
  const args = { output_key: outKey(), measures: measures("22222222"), cost };
  const results = await Promise.all([store.commit(c.job_id, args), store.commit(c.job_id, args), store.commit(c.job_id, args)]);
  for (const x of results) assert.equal(x.status, "done");
  await store.commit(c.job_id, args);
  assert.equal(await balance(u.id), 2);
  assert.equal((await ledger(u.id, r)).length, 1);
  const full = await row(c.job_id);
  assert.equal(full.job_text, null, "JSON do job apagado no done");
  assert.equal(full.diff_samples, 1000);
  assert.equal(full.diff_duration_ms, 20);
});

test("(e) sem saldo → INSUFFICIENT_CREDITS e nenhum job", { skip }, async () => {
  const u = await newUser(0);
  await assert.rejects(create(u, ref()), (e: RpcError) => e.code === "INSUFFICIENT_CREDITS");
  const jobs = await call(`/rest/v1/export_jobs?user_id=eq.${u.id}&select=id`);
  assert.equal(jobs.body.length, 0);
});

test("(f) saldo some entre reservar e debitar → failed + INSUFFICIENT_CREDITS", { skip }, async () => {
  const u = await newUser(1);
  const c = await create(u, ref());
  await store.start(c.job_id, 900_000);
  // o aparelho gasta o único crédito em outro export enquanto o servidor processa
  const [spend, commit] = await Promise.allSettled([
    rpc("spend_export_credit", { p_ref: ref(), p_kind: "audio" }, { key: ANON, token: u.token }),
    store.commit(c.job_id, { output_key: outKey(), measures: measures("33333333"), cost }),
  ]);
  assert.equal(spend.status, "fulfilled");
  const spendOk = spend.status === "fulfilled" && spend.value.ok;
  const full = await row(c.job_id);
  if (spendOk) {
    // o aparelho ganhou a corrida: o servidor não entrega nem cobra
    assert.equal(commit.status, "rejected");
    assert.ok(commit.status === "rejected" && commit.reason instanceof JobError && commit.reason.code === "INSUFFICIENT_CREDITS");
    assert.equal(full.status, "failed");
    assert.equal(full.error_code, "INSUFFICIENT_CREDITS");
    assert.equal(full.credit_state, "released");
  } else {
    // o servidor ganhou: o aparelho é que ficou sem saldo
    assert.equal(full.status, "done");
  }
  assert.equal(await balance(u.id), 0, "exatamente um débito no total");
});

test("(g) mesmo p_ref com outro áudio → REF_MISMATCH, sem cobrar", { skip }, async () => {
  const u = await newUser(2);
  const r = ref();
  await runToCommit(u, r, "aaaaaaaa");
  assert.equal(await balance(u.id), 1);
  // done reaproveitável impede um novo job; expira o anterior para forçar um novo processamento
  const first = await call(`/rest/v1/export_jobs?user_id=eq.${u.id}&select=id`);
  await call(`/rest/v1/export_jobs?id=eq.${first.body[0].id}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
  const c = await create(u, r);
  assert.equal(c.outcome, "created");
  assert.equal(c.credit_state, "charged", "o p_ref já foi pago");
  await store.start(c.job_id, 900_000);
  await assert.rejects(store.commit(c.job_id, { output_key: outKey(), measures: measures("bbbbbbbb"), cost }), (e: JobError) => e.code === "REF_MISMATCH");
  const full = await row(c.job_id);
  assert.equal(full.status, "failed");
  assert.equal(full.error_code, "REF_MISMATCH");
  assert.equal(await balance(u.id), 1);

  // ref pago no aparelho (sem âncora): ancora no primeiro uso no servidor
  const r2 = ref();
  await rpc("spend_export_credit", { p_ref: r2, p_kind: "audio" }, { key: ANON, token: u.token });
  await runToCommit(u, r2, "cccccccc");
  const anchor = await call(`/rest/v1/export_ref_anchors?user_id=eq.${u.id}&idempotency_ref=eq.${r2}&select=content_fingerprint`);
  assert.equal(anchor.body[0].content_fingerprint, "cccccccc");
});

test("(h) limites por usuário, teto global e interruptor → RATE_LIMITED / CAPACITY", { skip }, async () => {
  const u = await newUser(5);
  await create(u, ref());
  await assert.rejects(create(u, ref()), (e: RpcError) => e.code === "RATE_LIMITED", "1 job ativo");

  const v = await newUser(5);
  await setSetting("export_user_per_hour", 0);
  await assert.rejects(create(v, ref()), (e: RpcError) => e.code === "RATE_LIMITED", "por hora");
  await setSetting("export_user_per_hour", 1000);
  await setSetting("export_user_per_day", 0);
  await assert.rejects(create(v, ref()), (e: RpcError) => e.code === "RATE_LIMITED", "por dia");
  await setSetting("export_user_per_day", 1000);
  await setSetting("export_server_daily_cpu_s", 0);
  await assert.rejects(create(v, ref()), (e: RpcError) => e.code === "CAPACITY", "CPU do dia");
  await setSetting("export_server_daily_cpu_s", 10_000_000);
  await setSetting("export_server_enabled", false);
  await assert.rejects(create(v, ref()), (e: RpcError) => e.code === "CAPACITY", "interruptor");
  await setSetting("export_server_enabled", true);
  const ok = await create(v, ref());
  assert.equal(ok.outcome, "created");
});

test("(i) job preso é liberado pela limpeza; start retoma um running parado", { skip }, async () => {
  const u = await newUser(2);
  const c = await create(u, ref());
  await store.start(c.job_id, 900_000);
  assert.equal((await store.start(c.job_id, 900_000)).outcome, "busy");
  const old = new Date(Date.now() - 3600_000).toISOString();
  await call(`/rest/v1/export_jobs?id=eq.${c.job_id}`, { method: "PATCH", body: JSON.stringify({ started_at: old }) });
  const resumed = await store.start(c.job_id, 900_000);
  assert.equal(resumed.outcome, "started");
  assert.equal(resumed.record?.attempts, 2);

  await call(`/rest/v1/export_jobs?id=eq.${c.job_id}`, { method: "PATCH", body: JSON.stringify({ started_at: old }) });
  const cl = await store.cleanup(1800);
  assert.ok(cl.parados >= 1);
  const full = await row(c.job_id);
  assert.equal(full.status, "failed");
  assert.equal(full.error_code, "TIMEOUT");
  assert.equal(full.credit_state, "released");
  assert.equal(full.job_text, null);
  assert.equal(await balance(u.id), 2);
});

test("(j) invariante: charged ⇔ transação no ledger; nenhuma reserva presa", { skip }, async () => {
  const r = await rpc("export_jobs_invariant_violations", {});
  assert.ok(r.ok);
  assert.deepEqual(r.body, { charged_sem_transacao: 0, done_sem_charged: 0, reserva_em_job_encerrado: 0 });
});

test("(k) cliente não escreve nem chama as RPCs; o dono não vê job/input_key/output_key", { skip }, async () => {
  const u = await newUser(2);
  const { c } = await runToCommit(u, ref());
  const asUser = { key: ANON, token: u.token };
  const asAnon = { key: ANON };

  for (const auth of [asUser, asAnon]) {
    for (const fn of ["create_export_job", "start_export_job", "commit_export_credit", "release_export_credit", "requeue_export_job", "refund_export", "cleanup_export_jobs", "get_export_job", "report_export_progress"]) {
      const res = await rpc(fn, { p_job_id: c.job_id }, auth);
      assert.ok(!res.ok, `${fn} chamada pelo cliente`);
    }
    const ins = await call("/rest/v1/export_jobs", { method: "POST", body: JSON.stringify({ user_id: u.id, target: "wav", idempotency_ref: ref(), input_key: `in/${randomUUID()}` }), ...auth });
    assert.ok(!ins.ok, "insert direto");
    const upd = await call(`/rest/v1/export_job_status?job_id=eq.${c.job_id}`, { method: "PATCH", body: JSON.stringify({ progress: 1 }), ...auth });
    assert.ok(!upd.ok || (Array.isArray(upd.body) && upd.body.length === 0), "update no espelho");
    const direct = await call(`/rest/v1/export_jobs?select=*`, auth);
    assert.ok(!direct.ok || direct.body.length === 0, "leitura direta da tabela");
    const anchors = await call(`/rest/v1/export_ref_anchors?select=*`, auth);
    assert.ok(!anchors.ok || anchors.body.length === 0, "leitura das âncoras");
  }

  const mine = await call(`/rest/v1/my_export_jobs?select=*`, asUser);
  assert.ok(mine.ok);
  assert.equal(mine.body.length, 1);
  for (const col of ["job_text", "input_key", "output_key", "user_id"]) assert.ok(!(col in mine.body[0]), `view sem ${col}`);
  const forbidden = await call(`/rest/v1/my_export_jobs?select=input_key`, asUser);
  assert.ok(!forbidden.ok);
  const status = await call(`/rest/v1/export_job_status?select=*`, asUser);
  assert.ok(status.ok);
  assert.equal(status.body.length, 1);

  // outro usuário não vê nada
  const other = await newUser(0);
  const theirs = await call(`/rest/v1/my_export_jobs?select=id`, { key: ANON, token: other.token });
  assert.equal(theirs.body.length, 0);
  const theirStatus = await call(`/rest/v1/export_job_status?select=job_id`, { key: ANON, token: other.token });
  assert.equal(theirStatus.body.length, 0);

  // refund: só admin
  const refund = await rpc("refund_export", { p_job_id: c.job_id, p_admin: u.id });
  assert.ok(!refund.ok, "refund por não admin");
});
