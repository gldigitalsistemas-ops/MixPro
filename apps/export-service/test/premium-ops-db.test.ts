/**
 * Operação da Produção no banco de TESTE: recibo uma vez só, estorno (créditos e Mercado Pago), "refazer" sem cobrar.
 * Sem .env.export-test, tudo é pulado.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ENV_FILE = join(__dirname, "../../../.env.export-test");
const env: Record<string, string> = {};
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const URL_ = env.EXPORT_TEST_SUPABASE_URL ?? "";
const SERVICE = env.EXPORT_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON = env.EXPORT_TEST_SUPABASE_ANON_KEY ?? "";
const skip = !URL_ || !SERVICE || !ANON ? "sem .env.export-test (projeto de teste)" : false;
if (!skip && env.EXPORT_TEST_PROD_REF && URL_.includes(env.EXPORT_TEST_PROD_REF)) throw new Error("a URL de teste aponta para produção");

const users: string[] = [];
async function call(path: string, init: RequestInit & { key?: string; token?: string } = {}) {
  const key = init.key ?? SERVICE;
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${init.token ?? key}`, "Content-Type": "application/json", Prefer: "return=representation" } });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body: body as any };
}
const rpc = (fn: string, args: Record<string, unknown>, auth?: { key?: string; token?: string }) => call(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args), ...auth });
const balance = async (id: string) => (await rpc("credit_balance", { p_user: id, p_kind: "download" })).body as number;

async function newUser(credits: number) {
  const email = `premium-ops-${randomUUID()}@example.test`;
  const password = randomUUID();
  const c = await call("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  const id = c.body.id as string;
  users.push(id);
  const bal = await balance(id);
  if (bal !== credits) await rpc("grant_credits", { p_user: id, p_kind: "download", p_type: credits > bal ? "ADMIN_ADJUSTMENT" : "DOWNLOAD", p_amount: credits - bal, p_reason: "teste ops", p_idempotency_key: `ops-setup:${id}` });
  const t = await call("/auth/v1/token?grant_type=password", { method: "POST", key: ANON, body: JSON.stringify({ email, password }) });
  return { id, token: t.body.access_token as string };
}

after(async () => {
  if (skip) return;
  for (const id of users) await call(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
});

async function paidProject(u: { id: string }, product: string, method: "brl" | "credits", credits = 0, price = 249) {
  const pid = randomUUID();
  await call("/rest/v1/premium_projects", { method: "POST", body: JSON.stringify({ id: pid, user_id: u.id, product, title: "T", inputs: [`cofre/proj/${pid}/00`] }) });
  const o = await rpc("create_premium_order", { p_user: u.id, p_project: pid, p_product: product, p_method: method, p_price: price, p_list_price: price, p_credits: credits, p_intro: false, p_pro_discount: false });
  assert.ok(o.ok, JSON.stringify(o.body));
  if (method === "brl") await rpc("mark_premium_order_paid", { p_order: o.body.id, p_payment_order: null });
  return { pid, oid: o.body.id as string };
}

test("(a) recibo: reserva uma vez só; libera para tentar de novo; pedido não pago não gera", { skip }, async () => {
  const u = await newUser(0);
  const { oid } = await paidProject(u, "mix_ia", "brl");
  assert.equal((await rpc("claim_premium_receipt", { p_order: oid })).body, true);
  assert.equal((await rpc("claim_premium_receipt", { p_order: oid })).body, false, "segundo aviso não duplica");
  await rpc("release_premium_receipt", { p_order: oid });
  assert.equal((await rpc("claim_premium_receipt", { p_order: oid })).body, true, "depois de liberar, pode tentar de novo");
  const pending = await rpc("create_premium_order", { p_user: u.id, p_project: null, p_product: "mix_ia", p_method: "brl", p_price: 10, p_list_price: 10, p_credits: 0, p_intro: false, p_pro_discount: false });
  assert.equal((await rpc("claim_premium_receipt", { p_order: pending.body.id })).body, false);
  assert.equal((await rpc("claim_premium_receipt", { p_order: oid }, { key: ANON, token: u.token })).ok, false, "cliente não chama");
});

test("(b) estorno em créditos: devolve os créditos uma vez, corta o acesso e encerra o projeto", { skip }, async () => {
  const u = await newUser(50);
  const { pid, oid } = await paidProject(u, "vs_premium", "credits", 40, 39.9);
  assert.equal(await balance(u.id), 10);
  // trabalho final entregue (para testar o corte de acesso)
  const j = await rpc("create_tool_job", { p_user: u.id, p_tool: "stems_premium", p_params: { project_id: pid, preview: false }, p_inputs: [`cofre/proj/${pid}/00`], p_credits: 0, p_retention_days: 30 });
  assert.ok(j.ok, JSON.stringify(j.body));
  await rpc("start_tool_job", { p_job_id: j.body.job_id, p_stale_seconds: 900 });
  await rpc("commit_tool_job", { p_job_id: j.body.job_id, p_outputs: [{ key: `cofre/${j.body.job_id}/0.m4a`, name: "a.m4a", bytes: 1 }], p_measures: {}, p_cost: { cpu_ms: 1, rss_mb: 1, wall_ms: 1 } });
  const link = await call(`/rest/v1/premium_projects?id=eq.${pid}`, { method: "PATCH", body: JSON.stringify({ final_job: j.body.job_id }) });
  assert.ok(link.ok && link.body[0]?.final_job === j.body.job_id, JSON.stringify(link.body));

  const r = await rpc("refund_premium_order", { p_order: oid, p_note: "cliente insatisfeito" });
  assert.equal(r.body.status, "refunded", JSON.stringify(r.body));
  assert.equal(await balance(u.id), 50, "créditos de volta");
  assert.equal((await rpc("refund_premium_order", { p_order: oid })).body.idempotent, true);
  assert.equal(await balance(u.id), 50, "não devolve duas vezes");
  const order = (await call(`/rest/v1/premium_orders?id=eq.${oid}&select=status,refund_note`)).body[0];
  assert.deepEqual(order, { status: "refunded", refund_note: "cliente insatisfeito" });
  assert.equal((await call(`/rest/v1/premium_projects?id=eq.${pid}&select=status`)).body[0].status, "expired");
  const job = (await call(`/rest/v1/tool_jobs?id=eq.${j.body.job_id}&select=expires_at`)).body[0];
  // era "daqui a 30 dias"; agora é "agora" (folga de 10 min para a diferença de relógio entre este computador e o banco)
  assert.ok(new Date(job.expires_at).getTime() < Date.now() + 10 * 60_000, `arquivos deixam de valer: ${job.expires_at}`);
  await call(`/rest/v1/tool_jobs?id=eq.${j.body.job_id}`, { method: "DELETE" });
});

test("(c) estorno em reais não mexe nos créditos; pedido não pago não estorna; cliente não chama", { skip }, async () => {
  const u = await newUser(7);
  const { oid } = await paidProject(u, "mix_ia", "brl");
  const r = await rpc("refund_premium_order", { p_order: oid });
  assert.equal(r.body.status, "refunded");
  assert.equal(await balance(u.id), 7);
  const pending = await rpc("create_premium_order", { p_user: u.id, p_project: null, p_product: "mix_ia", p_method: "brl", p_price: 10, p_list_price: 10, p_credits: 0, p_intro: false, p_pro_discount: false });
  assert.match(String((await rpc("refund_premium_order", { p_order: pending.body.id })).body?.message), /NOT_PAID/);
  assert.equal((await rpc("refund_premium_order", { p_order: oid }, { key: ANON, token: u.token })).ok, false);
});

test("(d) refazer: só projeto pago; zera o trabalho final sem cobrar; bloqueia depois do estorno", { skip }, async () => {
  const u = await newUser(0);
  const { pid, oid } = await paidProject(u, "mix_ia", "brl");
  await call(`/rest/v1/premium_projects?id=eq.${pid}`, { method: "PATCH", body: JSON.stringify({ status: "delivered", final_job: null }) });
  const r = await rpc("redo_premium_project", { p_project: pid });
  assert.equal(r.body.user_id, u.id, JSON.stringify(r.body));
  const p = (await call(`/rest/v1/premium_projects?id=eq.${pid}&select=status,final_job`)).body[0];
  assert.deepEqual(p, { status: "paid", final_job: null });
  assert.equal(await balance(u.id), 0, "refazer não cobra");
  await rpc("refund_premium_order", { p_order: oid });
  assert.match(String((await rpc("redo_premium_project", { p_project: pid })).body?.message), /NOT_PAID/);
  const draft = randomUUID();
  await call("/rest/v1/premium_projects", { method: "POST", body: JSON.stringify({ id: draft, user_id: u.id, product: "mix_ia", title: "T", inputs: [`cofre/proj/${draft}/00`] }) });
  assert.match(String((await rpc("redo_premium_project", { p_project: draft })).body?.message), /NOT_PAID/);
});
