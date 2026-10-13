/**
 * Módulos premium contra o projeto Supabase de TESTE (nunca o de produção): pedidos, trava da
 * 1ª experiência, pagamento (créditos e Mercado Pago), estorno, engenheiro, vitrine e mapa de treino.
 * Sem .env.export-test, tudo é pulado.
 */
import { test, before, after } from "node:test";
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
const ANON = env.EXPORT_TEST_SUPABASE_ANON_KEY ?? "";
const SERVICE = env.EXPORT_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
const skip = !URL_ || !ANON || !SERVICE ? "sem .env.export-test (projeto de teste)" : false;
if (!skip && env.EXPORT_TEST_PROD_REF && URL_.includes(env.EXPORT_TEST_PROD_REF)) throw new Error("a URL de teste aponta para produção");

const users: string[] = [];

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

type User = { id: string; token: string };
async function newUser(credits: number): Promise<User> {
  const email = `premium-test-${randomUUID()}@example.test`;
  const password = randomUUID();
  const c = await call("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.ok(c.ok, "criar usuário de teste");
  const id = c.body.id as string;
  users.push(id);
  const bal = (await rpc("credit_balance", { p_user: id, p_kind: "download" })).body as number;
  if (bal !== credits) await rpc("grant_credits", { p_user: id, p_kind: "download", p_type: credits > bal ? "ADMIN_ADJUSTMENT" : "DOWNLOAD", p_amount: credits - bal, p_reason: "teste premium", p_idempotency_key: `prem-setup:${id}` });
  const t = await call("/auth/v1/token?grant_type=password", { method: "POST", key: ANON, body: JSON.stringify({ email, password }) });
  return { id, token: t.body.access_token };
}
const balance = async (id: string) => (await rpc("credit_balance", { p_user: id, p_kind: "download" })).body as number;
const hex = (c: string) => c.repeat(64);
async function project(u: User, product = "mix_ia") {
  const id = randomUUID();
  const r = await call("/rest/v1/premium_projects", { method: "POST", body: JSON.stringify({ id, user_id: u.id, product, title: "Teste", inputs: [`cofre/proj/${id}/00`] }) });
  assert.ok(r.ok, JSON.stringify(r.body));
  return id;
}
const order = (u: User, p: string | null, o: Partial<{ product: string; method: string; price: number; list: number; credits: number; intro: boolean; device: string; cpf: string; net: string | null }> = {}) =>
  rpc("create_premium_order", {
    p_user: u.id,
    p_project: p,
    p_product: o.product ?? "mix_ia",
    p_method: o.method ?? "brl",
    p_price: o.price ?? 49.9,
    p_list_price: o.list ?? 249,
    p_credits: o.credits ?? 0,
    p_intro: o.intro ?? false,
    p_pro_discount: false,
    p_device_hash: o.device ?? null,
    p_cpf_hash: o.cpf ?? null,
    p_net_hash: o.net ?? null,
  });

after(async () => {
  if (skip) return;
  for (const id of users) await call(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
});

test("(a) 1ª experiência: uma vez por pessoa — mesma conta, mesmo aparelho, mesmo CPF ou mesma rede+navegador são barrados", { skip }, async () => {
  const a = await newUser(0);
  const b = await newUser(0);
  const c = await newUser(0);
  const d = await newUser(0);
  const pa = await project(a);
  const first = await order(a, pa, { intro: true, device: hex("1"), cpf: hex("2"), net: hex("3") });
  assert.ok(first.ok, JSON.stringify(first.body));
  assert.equal(first.body.intro, true);
  // mesma conta de novo (outro projeto)
  const again = await order(a, await project(a), { intro: true, device: hex("4"), cpf: hex("5") });
  assert.match(String(again.body?.message), /INTRO_USED/);
  // outra conta no mesmo aparelho
  assert.match(String((await order(b, await project(b), { intro: true, device: hex("1"), cpf: hex("6") })).body?.message), /INTRO_USED/);
  // outra conta com o mesmo CPF
  assert.match(String((await order(c, await project(c), { intro: true, device: hex("7"), cpf: hex("2") })).body?.message), /INTRO_USED/);
  // outra conta, aparelho e CPF novos, mas mesma rede + mesmo navegador (aba anônima)
  assert.match(String((await order(d, await project(d), { intro: true, device: hex("8"), cpf: hex("9"), net: hex("3") })).body?.message), /INTRO_USED/);
  // sem identidade, a oferta é recusada
  assert.match(String((await order(d, await project(d), { intro: true })).body?.message), /INTRO_NEEDS_ID/);
  // o preço normal continua para todos
  assert.ok((await order(b, await project(b))).ok);
  // outro produto: a 1ª experiência dele continua disponível
  assert.ok((await order(a, await project(a, "vs_premium"), { product: "vs_premium", intro: true, device: hex("1"), cpf: hex("2"), price: 19.9, list: 39.9 })).ok);
});

test("(b) corrida: duas compras simultâneas com o mesmo CPF → só uma leva a oferta", { skip }, async () => {
  const a = await newUser(0);
  const b = await newUser(0);
  const [r1, r2] = await Promise.all([
    order(a, await project(a), { intro: true, device: hex("a"), cpf: hex("b") }),
    order(b, await project(b), { intro: true, device: hex("c"), cpf: hex("b") }),
  ]);
  assert.equal([r1, r2].filter((r) => r.ok).length, 1, `${JSON.stringify(r1.body)} ${JSON.stringify(r2.body)}`);
});

test("(c) pedido pendente cancelado devolve a oferta; novo checkout do mesmo projeto substitui o anterior", { skip }, async () => {
  const a = await newUser(0);
  const p = await project(a);
  const o1 = await order(a, p, { intro: true, device: hex("d"), cpf: hex("e") });
  assert.ok(o1.ok);
  const o2 = await order(a, p, { intro: true, device: hex("d"), cpf: hex("e") });
  assert.ok(o2.ok, "o checkout novo do mesmo projeto libera o anterior");
  const old = (await call(`/rest/v1/premium_orders?id=eq.${o1.body.id}&select=status`)).body[0];
  assert.equal(old.status, "cancelled");
  // limpeza de 26 h devolve a oferta
  await call(`/rest/v1/premium_orders?id=eq.${o2.body.id}`, { method: "PATCH", body: JSON.stringify({ created_at: new Date(Date.now() - 27 * 3600_000).toISOString() }) });
  await rpc("cancel_stale_premium_orders", {});
  const claim = (await call(`/rest/v1/intro_claims?order_id=eq.${o2.body.id}&select=status`)).body[0];
  assert.equal(claim.status, "released");
  assert.ok((await order(a, p, { intro: true, device: hex("d"), cpf: hex("e") })).ok, "pode usar a oferta de novo");
});

test("(d) créditos: paga na hora, projeto pago; sem saldo recusa; mesmo projeto não paga duas vezes", { skip }, async () => {
  const a = await newUser(50);
  const p = await project(a, "vs_premium");
  const r = await order(a, p, { product: "vs_premium", method: "credits", credits: 40, price: 39.9, list: 39.9 });
  assert.ok(r.ok, JSON.stringify(r.body));
  assert.equal(r.body.status, "paid");
  assert.equal(await balance(a.id), 10);
  assert.equal((await call(`/rest/v1/premium_projects?id=eq.${p}&select=status,order_id`)).body[0].status, "paid");
  assert.match(String((await order(a, p, { product: "vs_premium", method: "credits", credits: 40, price: 39.9, list: 39.9 })).body?.message), /ALREADY_PAID/);
  const poor = await newUser(5);
  assert.match(String((await order(poor, await project(poor, "vs_premium"), { product: "vs_premium", method: "credits", credits: 40, price: 39.9, list: 39.9 })).body?.message), /INSUFFICIENT_CREDITS/);
});

test("(e) Mercado Pago: aprovação libera o projeto e usa a oferta; estorno marca reembolsado; engenheiro vira pedido da Mixagem Pro", { skip }, async () => {
  const a = await newUser(0);
  const p = await project(a);
  const o = await order(a, p, { intro: true, device: hex("f"), cpf: hex("0") });
  const po = await call("/rest/v1/payment_orders", { method: "POST", body: JSON.stringify({ user_id: a.id, pack_id: `prem:${o.body.id}`, amount_brl: 49.9, credits_amount: 1 }) });
  const ref = po.body[0].mp_external_ref;
  const ap = await rpc("approve_payment_order", { p_external_ref: ref, p_mp_payment_id: "123", p_idempotency_key: `mp_payment_${randomUUID()}`, p_amount_paid: 49.9 });
  assert.ok(ap.ok, JSON.stringify(ap.body));
  assert.equal((await call(`/rest/v1/premium_orders?id=eq.${o.body.id}&select=status`)).body[0].status, "paid");
  assert.equal((await call(`/rest/v1/premium_projects?id=eq.${p}&select=status`)).body[0].status, "paid");
  assert.equal((await call(`/rest/v1/intro_claims?order_id=eq.${o.body.id}&select=status`)).body[0].status, "used");
  assert.equal(await balance(a.id), 0, "pedido premium não vira crédito");
  // engenheiro finaliza
  const eng = await order(a, p, { product: "eng_finaliza", price: 197, list: 197 });
  assert.ok(eng.ok, JSON.stringify(eng.body));
  const po2 = await call("/rest/v1/payment_orders", { method: "POST", body: JSON.stringify({ user_id: a.id, pack_id: `prem:${eng.body.id}`, amount_brl: 197, credits_amount: 1 }) });
  await rpc("approve_payment_order", { p_external_ref: po2.body[0].mp_external_ref, p_mp_payment_id: "124", p_idempotency_key: `mp_payment_${randomUUID()}`, p_amount_paid: 197 });
  const pro = (await call(`/rest/v1/pro_orders?user_id=eq.${a.id}&select=status,files_url,project_name`)).body;
  assert.equal(pro.length, 1);
  assert.equal(pro[0].status, "paid");
  assert.equal(pro[0].files_url, `/premium/${p}`);
  assert.equal((await call(`/rest/v1/premium_projects?id=eq.${p}&select=order_id`)).body[0].order_id, o.body.id, "o pedido do projeto continua o da mix");
  // estorno
  const rv = await rpc("reverse_payment_order", { p_external_ref: ref, p_mp_payment_id: "123", p_reason: "refunded" });
  assert.equal(rv.body, "refunded");
  assert.equal((await call(`/rest/v1/premium_orders?id=eq.${o.body.id}&select=status`)).body[0].status, "refunded");
});

test("(f) vitrine: só o dono vê/retira; aprovação credita o presente uma vez; cliente não chama as RPCs", { skip }, async () => {
  const a = await newUser(0);
  const b = await newUser(0);
  const id = randomUUID();
  const ins = await call("/rest/v1/showcase_items", { method: "POST", body: JSON.stringify({ id, user_id: a.id, product: "mix_ia", title: "Minha música", after_key: `vitrine/${id}/depois.m4a`, before_key: `vitrine/${id}/antes.m4a`, consent_at: new Date().toISOString() }) });
  assert.ok(ins.ok, JSON.stringify(ins.body));
  assert.equal((await call(`/rest/v1/showcase_items?select=id`, { key: ANON, token: b.token })).body.length, 0, "outro usuário não vê");
  assert.equal((await call(`/rest/v1/showcase_items?select=id`, { key: ANON, token: a.token })).body.length, 1, "o dono vê");
  assert.equal((await rpc("review_showcase_item", { p_item: id, p_approve: true }, { key: ANON, token: a.token })).ok, false, "cliente não aprova");
  await rpc("review_showcase_item", { p_item: id, p_approve: true });
  await rpc("review_showcase_item", { p_item: id, p_approve: true });
  assert.equal(await balance(a.id), 10, "presente uma vez só");
  assert.match(String((await rpc("revoke_showcase_item", { p_item: id, p_user: b.id })).body?.message), /NOT_FOUND/);
  const rv = await rpc("revoke_showcase_item", { p_item: id, p_user: a.id });
  assert.equal(rv.body, `vitrine/${id}/antes.m4a|vitrine/${id}/depois.m4a`);
  assert.equal((await call(`/rest/v1/showcase_items?id=eq.${id}&select=status`)).body[0].status, "revoked");
});

test("(g) mapa de treino e projetos: só admin lê o treino; projeto é visível só ao dono; cliente não cria pedido", { skip }, async () => {
  const a = await newUser(0);
  const b = await newUser(0);
  await call("/rest/v1/training_assets", { method: "POST", body: JSON.stringify({ genre: "worship", title: "Teste", rights_confirmed: true }) });
  assert.equal((await call(`/rest/v1/training_assets?select=id`, { key: ANON, token: a.token })).body.length, 0);
  const p = await project(a);
  assert.equal((await call(`/rest/v1/premium_projects?id=eq.${p}&select=id`, { key: ANON, token: b.token })).body.length, 0);
  assert.equal((await call(`/rest/v1/premium_projects?id=eq.${p}&select=id`, { key: ANON, token: a.token })).body.length, 1);
  assert.equal((await rpc("create_premium_order", { p_user: a.id, p_project: p, p_product: "mix_ia", p_method: "brl", p_price: 0.01, p_list_price: 0.01, p_credits: 0, p_intro: false, p_pro_discount: false }, { key: ANON, token: a.token })).ok, false, "preço nunca vem do cliente");
  assert.equal((await call("/rest/v1/premium_projects", { method: "POST", key: ANON, token: a.token, body: JSON.stringify({ user_id: a.id, product: "mix_ia" }) })).ok, false, "cliente não grava projeto");
  await call(`/rest/v1/training_assets?title=eq.Teste`, { method: "DELETE" });
});

test("(h) esteira: jobs premium só com entradas do Cofre do próprio projeto; saídas com muitos arquivos", { skip }, async () => {
  const a = await newUser(0);
  const b = await newUser(0);
  const p = await project(a);
  const ok = await rpc("create_tool_job", { p_user: a.id, p_tool: "mix_ia", p_params: { project_id: p, preview: true }, p_inputs: [`cofre/proj/${p}/00`, `cofre/proj/${p}/01`], p_credits: 0, p_retention_days: 1 });
  assert.ok(ok.ok, JSON.stringify(ok.body));
  const other = await rpc("create_tool_job", { p_user: b.id, p_tool: "mix_ia", p_params: { project_id: p, preview: true }, p_inputs: [`cofre/proj/${p}/00`], p_credits: 0, p_retention_days: 1 });
  assert.match(String(other.body?.message), /INVALID_JOB/, "projeto de outra pessoa");
  const wrongKey = await rpc("create_tool_job", { p_user: a.id, p_tool: "mix_ia", p_params: { project_id: p, preview: true }, p_inputs: [`cofre/proj/${randomUUID()}/00`], p_credits: 0, p_retention_days: 1 });
  assert.match(String(wrongKey.body?.message), /INVALID_JOB/, "entrada de outro projeto");
  const jobId = ok.body.job_id;
  await rpc("start_tool_job", { p_job_id: jobId, p_stale_seconds: 900 });
  const outs = Array.from({ length: 50 }, (_, i) => ({ key: `cofre/${jobId}/${i}.m4a`, name: `mixer-${String(i).padStart(2, "0")}.m4a`, bytes: 10 }));
  const c = await rpc("commit_tool_job", { p_job_id: jobId, p_outputs: outs, p_measures: {}, p_cost: { cpu_ms: 1, rss_mb: 1, wall_ms: 1, api_usd: 0.5 } });
  assert.ok(c.ok, JSON.stringify(c.body));
  await call(`/rest/v1/tool_jobs?id=eq.${jobId}`, { method: "DELETE" });
});

test("(i) admin usa tudo grátis: saldo ilimitado, nenhum débito gravado, pedido premium pago na hora; usuário comum continua pagando", { skip }, async () => {
  const adm = await newUser(0);
  const u = await newUser(3);
  await call(`/rest/v1/profiles?id=eq.${adm.id}`, { method: "PATCH", body: JSON.stringify({ role: "admin" }) });
  assert.equal(await balance(adm.id), 999999);
  // download (exportação no aparelho) com o token do admin
  const s = await rpc("spend_export_credit", { p_ref: `adm${randomUUID().slice(0, 8)}`, p_kind: "audio" }, { key: ANON, token: adm.token });
  assert.ok(s.ok, JSON.stringify(s.body));
  // ferramenta: reserva e entrega sem débito
  const j = await rpc("create_tool_job", { p_user: adm.id, p_tool: "pitch_tempo", p_params: { a: 1 }, p_inputs: [`in/${randomUUID()}`], p_credits: 5, p_retention_days: 1 });
  assert.ok(j.ok, JSON.stringify(j.body));
  await rpc("start_tool_job", { p_job_id: j.body.job_id, p_stale_seconds: 900 });
  const c = await rpc("commit_tool_job", { p_job_id: j.body.job_id, p_outputs: [{ key: `out/${j.body.job_id}/0.mp3`, name: "a.mp3", bytes: 1 }], p_measures: {}, p_cost: { cpu_ms: 1, rss_mb: 1, wall_ms: 1 } });
  assert.equal(c.body.status, "done");
  const debits = (await call(`/rest/v1/credit_transactions?user_id=eq.${adm.id}&amount=lt.0&idempotency_key=not.like.prem-setup*&select=id`)).body;
  assert.equal(debits.length, 0, "nenhum débito do admin");
  // pedido premium do admin: pago na hora com valor zero
  const p = await project(adm, "mix_ia");
  const o = await order(adm, p, { method: "credits", price: 0, list: 249, credits: 1 });
  assert.ok(o.ok, JSON.stringify(o.body));
  assert.equal(o.body.status, "paid");
  assert.equal(Number(o.body.price_brl), 0);
  // usuário comum continua pagando
  const j2 = await rpc("create_tool_job", { p_user: u.id, p_tool: "pitch_tempo", p_params: { a: 1 }, p_inputs: [`in/${randomUUID()}`], p_credits: 5, p_retention_days: 1 });
  assert.match(String(j2.body?.message), /INSUFFICIENT_CREDITS/);
  assert.equal(await balance(u.id), 3);
  await call(`/rest/v1/tool_jobs?id=eq.${j.body.job_id}`, { method: "DELETE" });
});
