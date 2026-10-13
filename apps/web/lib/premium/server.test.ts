import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePremium, type PremiumId } from "@mixpro/contracts";
import { checkout, createProject, projectStatus, quote, revise, startFinal, startPreview, type Order, type PremiumDeps, type Project } from "./server";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000002";

function harness(o: { pro?: boolean; previews?: number; introUsed?: boolean } = {}) {
  const projects = new Map<string, Project>();
  const orders = new Map<string, Order & { project_id: string; user_id: string }>();
  const jobs = new Map<string, Record<string, unknown>>();
  const stored = new Map<string, number>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const enq: { id: string; opts: unknown }[] = [];
  const checkouts: unknown[] = [];
  let n = 0;
  const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const d: PremiumDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "create_tool_job") {
        const id = uid();
        jobs.set(id, { id, user_id: args.p_user, status: "queued", progress: 0, outputs: null, error_code: null, measures: null, params: args.p_params, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
        return { data: { job_id: id }, error: null };
      }
      if (fn === "get_tool_job") return { data: jobs.get(args.p_job_id as string) ?? null, error: null };
      if (fn === "create_premium_order") {
        if (args.p_intro && o.introUsed) return { data: null, error: { message: "INTRO_USED" } };
        const id = uid();
        const paid = args.p_method === "credits";
        const row = { id, product: args.p_product as PremiumId, status: paid ? "paid" : "pending_payment", price_brl: args.p_price as number, list_price_brl: args.p_list_price as number, intro: args.p_intro as boolean, method: args.p_method as string, paid_at: paid ? new Date().toISOString() : null, project_id: args.p_project as string, user_id: args.p_user as string };
        orders.set(id, row);
        const p = projects.get(args.p_project as string)!;
        projects.set(p.id, { ...p, order_id: id });
        return { data: row, error: null };
      }
      if (fn === "cancel_tool_job") return { data: {}, error: null };
      return { data: null, error: { message: "?" } };
    },
    objects: {
      presign: (m, k, ttl, opt) => `https://r2.test/${m}/${k}?len=${opt?.contentLength ?? ""}`,
      head: async (k) => (stored.has(k) ? { size: stored.get(k)! } : null),
      delete: async () => {},
      copy: async () => {},
    },
    queue: { mode: "push", enqueue: async (id, opts) => (enq.push({ id, opts }), { id }), dequeue: async () => null, ack: async () => {}, fail: async () => "dead", retry: async () => {} },
    catalog: async () => parsePremium(null),
    isPro: async () => Boolean(o.pro),
    projects: {
      get: async (id) => projects.get(id) ?? null,
      insert: async (p) => void projects.set(p.id, { ...p, status: p.status ?? "draft", order_id: null, preview_job: null, final_job: null, revisions: 0, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() } as Project),
      update: async (id, patch) => void projects.set(id, { ...projects.get(id)!, ...patch }),
    },
    orders: { get: async (id) => orders.get(id) ?? null },
    previewsToday: async () => o.previews ?? 0,
    previewLimit: async () => 6,
    introUsed: async () => Boolean(o.introUsed),
    checkout: async (c) => (checkouts.push(c), { initPoint: "https://mp.test/pay" }),
    introSecret: () => "segredo",
    heavyAvailable: () => true,
    newId: uid,
  };
  return { d, projects, orders, jobs, stored, calls, enq, checkouts };
}

const track = (name: string, role: string) => ({ name, role, gain_db: 0, pan: null, mute: false, eq_low: 0, eq_mid: 0, eq_high: 0, comp: null, reverb: null, tune: 0 });
const mixParams = { format: "wav", durations: [180, 180, 200], has_reference: true, ref_amount: 0.7, genre: "worship", align: true, tracks: [track("Voz.wav", "lead_vocal"), track("Baixo.wav", "bass")], master_chain: null, master_name: null, target_lufs: -11 };

async function uploaded(h: ReturnType<typeof harness>, product: string, files: { name: string; bytes: number }[]) {
  const r = await createProject(h.d, ALICE, { product, files });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) throw new Error();
  const p = h.projects.get(r.projectId)!;
  p.inputs.forEach((k, i) => h.stored.set(k, files[i].bytes));
  return r.projectId;
}

test("criar projeto: envio direto ao Cofre do projeto com tamanho assinado; limites por produto", async () => {
  const h = harness();
  const r = await createProject(h.d, ALICE, { product: "mix_ia", files: [{ name: "C:\\proj\\Voz Principal.wav", bytes: 100 }, { name: "Baixo.wav", bytes: 200 }] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.uploads.length, 2);
  assert.match(r.uploads[1], new RegExp(`cofre/proj/${r.projectId}/01\\?len=200`));
  assert.equal(h.projects.get(r.projectId)!.input_meta[0].name, "Voz Principal.wav");
  assert.equal((await createProject(h.d, ALICE, { product: "vs_premium", files: [{ name: "a.wav", bytes: 1 }, { name: "b.wav", bytes: 1 }] })).ok, false);
  assert.equal((await createProject(h.d, ALICE, { product: "mix_ia", files: [{ name: "a.wav", bytes: 1 }] })).ok, false, "mix precisa de 2+ pistas");
  assert.equal((await createProject(h.d, ALICE, { product: "xyz", files: [{ name: "a.wav", bytes: 1 }] })).ok, false);
});

test("prévia grátis: confere os arquivos, cria o job sem créditos e respeita o limite do dia", async () => {
  const h = harness();
  const id = await uploaded(h, "mix_ia", [{ name: "Voz.wav", bytes: 100 }, { name: "Baixo.wav", bytes: 200 }, { name: "Ref.mp3", bytes: 50 }]);
  const r = await startPreview(h.d, ALICE, id, mixParams);
  assert.ok(r.ok, JSON.stringify(r));
  const c = h.calls.find((x) => x.fn === "create_tool_job")!.args;
  assert.equal(c.p_credits, 0);
  assert.equal(c.p_tool, "mix_ia");
  assert.equal((c.p_params as { preview: boolean }).preview, true);
  assert.deepEqual(h.enq[0].opts, { kind: "tool", heavy: true, priority: false });
  assert.equal(h.projects.get(id)!.status, "preview");
  // outro dono não mexe
  assert.equal((await startPreview(h.d, BOB, id, mixParams)).ok, false);
  // limite do dia
  assert.equal((await startPreview(harness({ previews: 6 }).d, ALICE, id, mixParams)).ok, false);
  // arquivo não enviado
  const h2 = harness();
  const r2 = await createProject(h2.d, ALICE, { product: "mix_ia", files: [{ name: "a.wav", bytes: 1 }, { name: "b.wav", bytes: 1 }, { name: "r.wav", bytes: 1 }] });
  assert.ok(r2.ok);
  if (r2.ok) assert.equal((await startPreview(h2.d, ALICE, r2.projectId, mixParams)).ok, false);
});

test("trabalho final só depois de pago; créditos pagam na hora (VS Premium) e já iniciam", async () => {
  const h = harness();
  const id = await uploaded(h, "vs_premium", [{ name: "musica.mp3", bytes: 300 }]);
  await startPreview(h.d, ALICE, id, { format: "wav", durations: [240] });
  const blocked = await startFinal(h.d, ALICE, id);
  assert.ok(!blocked.ok && blocked.code === "PAYMENT_REQUIRED");
  const c = await checkout(h.d, ALICE, id, { method: "credits", useIntro: false, ip: null, email: "a@gmail.com", emailConfirmed: true });
  assert.ok(c.ok && c.paid, JSON.stringify(c));
  if (!c.ok) return;
  assert.equal(c.quote.credits, 40);
  const p = h.projects.get(id)!;
  assert.ok(p.final_job, "trabalho final começou");
  assert.equal((h.jobs.get(p.final_job!)!.params as { preview: boolean }).preview, false);
});

test("pagamento em reais: 1ª experiência exige identidade; CPF inválido explica; pago depois inicia no status", async () => {
  const h = harness();
  const id = await uploaded(h, "mix_ia", [{ name: "Voz.wav", bytes: 100 }, { name: "Baixo.wav", bytes: 200 }, { name: "Ref.mp3", bytes: 50 }]);
  await startPreview(h.d, ALICE, id, mixParams);
  const bad = await checkout(h.d, ALICE, id, { method: "brl", useIntro: true, deviceId: "a".repeat(32), cpf: "123", fingerprint: "b".repeat(32), ip: "1.2.3.4", email: "a@gmail.com", emailConfirmed: true });
  assert.ok(!bad.ok && bad.code === "INTRO_CPF_INVALID");
  const credits = await checkout(h.d, ALICE, id, { method: "credits", useIntro: false, ip: null, email: null, emailConfirmed: true });
  assert.ok(!credits.ok, "mix é só em reais");
  const ok = await checkout(h.d, ALICE, id, { method: "brl", useIntro: true, deviceId: "a".repeat(32), cpf: "529.982.247-25", fingerprint: "b".repeat(32), ip: "1.2.3.4", email: "a@gmail.com", emailConfirmed: true });
  assert.ok(ok.ok && !ok.paid && ok.initPoint, JSON.stringify(ok));
  if (!ok.ok) return;
  assert.equal(ok.quote.price_brl, 49.9);
  const args = h.calls.find((x) => x.fn === "create_premium_order")!.args;
  assert.match(String(args.p_cpf_hash), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(args).includes("52998224725"), false, "CPF nunca vai ao banco");
  // webhook aprova → status inicia o trabalho final
  const o = h.orders.get(ok.orderId)!;
  h.orders.set(o.id, { ...o, status: "paid", paid_at: new Date().toISOString() });
  const st = await projectStatus(h.d, ALICE, id);
  assert.ok(st.ok && st.paid && st.final);
});

test("1ª experiência já usada (outra conta, aparelho ou CPF) → mensagem clara; preço normal continua", async () => {
  const h = harness({ introUsed: true });
  const id = await uploaded(h, "vs_premium", [{ name: "m.mp3", bytes: 10 }]);
  await startPreview(h.d, ALICE, id, { format: "wav", durations: [100] });
  const r = await checkout(h.d, ALICE, id, { method: "brl", useIntro: true, deviceId: "a".repeat(32), cpf: "529.982.247-25", fingerprint: null, ip: null, email: "a@gmail.com", emailConfirmed: true });
  assert.ok(!r.ok && r.code === "INTRO_USED");
  const q = await quote(h.d, ALICE, "vs_premium", 4);
  assert.equal(q.intro, null);
  assert.equal(q.regular?.price_brl, 39.9);
});

test("revisões da mix: só pagas, dentro do prazo; pacote do compositor libera a voz finalizada", async () => {
  const h = harness();
  const id = await uploaded(h, "mix_ia", [{ name: "Voz.wav", bytes: 100 }, { name: "Baixo.wav", bytes: 200 }, { name: "Ref.mp3", bytes: 50 }]);
  await startPreview(h.d, ALICE, id, mixParams);
  assert.equal((await revise(h.d, ALICE, id, mixParams)).ok, false, "sem pagamento");
  const c = await checkout(h.d, ALICE, id, { method: "brl", useIntro: false, ip: null, email: null, emailConfirmed: true });
  assert.ok(c.ok);
  if (!c.ok) return;
  const o = h.orders.get(c.orderId)!;
  h.orders.set(o.id, { ...o, status: "paid", paid_at: new Date().toISOString() });
  const r = await revise(h.d, ALICE, id, { ...mixParams, tracks: [{ ...mixParams.tracks[0], gain_db: 2 }, mixParams.tracks[1]] });
  assert.ok(r.ok);
  assert.equal(h.projects.get(id)!.revisions, 1);
  h.orders.set(o.id, { ...o, status: "paid", paid_at: new Date(Date.now() - 8 * 86_400_000).toISOString() });
  const late = await revise(h.d, ALICE, id, mixParams);
  assert.ok(!late.ok && late.code === "REVISION_CLOSED");

  // produção paga como pacote → voz finalizada filha liberada sem novo pagamento
  const prod = await uploaded(h, "producao", [{ name: "guia.m4a", bytes: 10 }]);
  const pc = await checkout(h.d, ALICE, prod, { product: "pacote_compositor", method: "brl", useIntro: false, ip: null, email: null, emailConfirmed: true });
  assert.ok(pc.ok);
  if (!pc.ok) return;
  const po = h.orders.get(pc.orderId)!;
  assert.equal(po.product, "pacote_compositor");
  h.orders.set(po.id, { ...po, status: "paid", paid_at: new Date().toISOString() });
  const v = await createProject(h.d, ALICE, { product: "voz_final", files: [{ name: "voz.wav", bytes: 10 }, { name: "base.wav", bytes: 20 }], parentId: prod });
  assert.ok(v.ok);
  if (!v.ok) return;
  h.projects.get(v.projectId)!.inputs.forEach((k, i) => h.stored.set(k, [10, 20][i]));
  const vf = await startFinal(h.d, ALICE, v.projectId, { format: "wav", durations: [100, 100], has_reference: false, ref_amount: 0.5, genre: "worship", tune: 40, melody: null, vocal_level_db: 0, reverb: 30, master_chain: null, master_name: null, target_lufs: -11 });
  assert.ok(vf.ok, JSON.stringify(vf));
});

test("admin: libera na hora sem Mercado Pago, sem CPF e sem limite de prévias", async () => {
  const h = harness({ previews: 99 });
  h.d.isAdmin = async () => true;
  const id = await uploaded(h, "mix_ia", [{ name: "Voz.wav", bytes: 100 }, { name: "Baixo.wav", bytes: 200 }, { name: "Ref.mp3", bytes: 50 }]);
  assert.ok((await startPreview(h.d, ALICE, id, mixParams)).ok, "sem limite diário");
  const r = await checkout(h.d, ALICE, id, { method: "brl", useIntro: false, ip: null, email: null, emailConfirmed: false });
  assert.ok(r.ok && r.paid && !r.initPoint, JSON.stringify(r));
  const args = h.calls.find((x) => x.fn === "create_premium_order")!.args;
  assert.equal(args.p_price, 0);
  assert.equal(args.p_method, "credits");
  assert.equal(h.checkouts.length, 0, "não abre o Mercado Pago");
  assert.ok(h.projects.get(id)!.final_job, "trabalho final começou");
});
