/**
 * Fluxo dos módulos premium (rotas /api/premium/*), separado das rotas para teste com dependências falsas.
 *
 *   criar projeto (URLs de envio para o Cofre do projeto) → prévia grátis de 30 s → preço (1ª experiência
 *   ou profissional, desconto Pro) → pedido (reais no Mercado Pago ou créditos) → pago: trabalho final →
 *   entrega no Cofre (30 dias) → revisões (mix e voz) → vitrine com consentimento.
 *
 * Nunca confia no cliente: preço calculado aqui, parâmetros validados pelo contrato (e de novo no serviço),
 * dono conferido em toda operação, entradas conferidas no armazenamento antes de enfileirar.
 */
import { randomUUID } from "node:crypto";
import {
  ordersUnlock,
  parsePremiumParams,
  quotePremium,
  PREMIUM_IDS,
  PROJECT_PRODUCTS,
  type PremiumCatalog,
  type PremiumId,
  type PremiumQuote,
  type PremiumToolId,
  type ProjectProduct,
} from "@mixpro/contracts";
import { exportErrorInfo } from "@/lib/export/error-messages";
import type { Fail, Ok } from "@/lib/export/server-jobs";
import type { QueueService } from "@/lib/export/queue";
import { MAX_INPUT_BYTES } from "@/lib/export/server-limits";
import { INTRO_REASON_MESSAGE, introIdentity } from "./identity";

export type Project = {
  id: string;
  user_id: string;
  product: ProjectProduct;
  title: string;
  status: string;
  params: Record<string, unknown>;
  inputs: string[];
  input_meta: { name: string; bytes: number; role?: string }[];
  minutes: number;
  order_id: string | null;
  preview_job: string | null;
  final_job: string | null;
  revisions: number;
  parent_id: string | null;
  created_at: string;
  expires_at: string;
};

export type Order = { id: string; product: PremiumId; status: string; price_brl: number; list_price_brl: number; intro: boolean; method: string; paid_at: string | null };

type Job = { id: string; user_id: string; status: string; progress: number; outputs: { key: string; name: string; bytes: number }[] | null; error_code: string | null; measures: Record<string, unknown> | null; expires_at: string; params: Record<string, unknown> };

export type PremiumDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  objects: {
    presign: (method: "GET" | "PUT", key: string, expiresS: number, opts?: { contentLength?: number; downloadName?: string }) => string;
    head: (key: string) => Promise<{ size: number } | null>;
    delete: (key: string) => Promise<void>;
    copy: (from: string, to: string) => Promise<void>;
  };
  queue: QueueService;
  catalog: () => Promise<PremiumCatalog>;
  isPro: (userId: string) => Promise<boolean>;
  projects: {
    get: (id: string) => Promise<Project | null>;
    insert: (p: Omit<Project, "created_at" | "expires_at" | "status" | "order_id" | "preview_job" | "final_job" | "revisions"> & { status?: string }) => Promise<void>;
    update: (id: string, patch: Partial<Project>) => Promise<void>;
  };
  orders: { get: (id: string) => Promise<Order | null> };
  /** Prévias criadas hoje pela pessoa (limite diário). */
  previewsToday: (userId: string) => Promise<number>;
  previewLimit: () => Promise<number>;
  /** A pessoa já usou a 1ª experiência deste produto (só a conta; a trava completa é no banco). */
  introUsed: (userId: string, product: PremiumId) => Promise<boolean>;
  checkout: (o: { userId: string; email: string | null; orderId: string; title: string; price: number; returnPath: string; cpf: string | null }) => Promise<{ initPoint: string }>;
  introSecret: () => string;
  heavyAvailable: () => boolean;
  /** Admin vê qualquer projeto (o engenheiro abre o projeto da IA no "Engenheiro finaliza"). */
  isAdmin?: (userId: string) => Promise<boolean>;
  newId?: () => string;
};

const fail = (code: string, message?: string): Fail => {
  const i = exportErrorInfo(code);
  return { ok: false, status: i.status, code, message: message ?? (i.device ? "Não conseguimos processar agora. Tente de novo em alguns minutos." : i.message), device: false };
};

function rpcCode(error: { message: string }): string {
  const m = error.message.match(/\b(INSUFFICIENT_CREDITS|RATE_LIMITED|CAPACITY|INVALID_JOB|INVALID|INTRO_USED|INTRO_NEEDS_ID|ALREADY_PAID|NOT_FOUND|JOB_NOT_FOUND)\b/);
  return m ? m[1] : "INTERNAL";
}

/** Recurso de cada produto com projeto. */
export const PRODUCT_TOOL: Record<ProjectProduct, PremiumToolId> = { vs_premium: "stems_premium", mix_ia: "mix_ia", producao: "compose", voz_final: "voice_final" };

/** Quantos arquivos cada produto recebe (mín., máx.). */
function fileLimits(product: ProjectProduct, cat: PremiumCatalog): [number, number] {
  const item = cat.items.find((i) => i.id === product);
  switch (product) {
    case "vs_premium":
      return [1, 1];
    case "mix_ia":
      // pistas + referência opcional
      return [2, (item?.max_tracks ?? 24) + 1];
    case "producao":
      return [1, 2];
    case "voz_final":
      // voz (+ referência); a base vem da produção escolhida ou é enviada
      return [1, 3];
  }
}

export const safeFileName = (n: string) =>
  (n.split(/[\\/]/).pop() ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._()+-]+/g, "-")
    .slice(-60) || "arquivo";

async function owned(d: PremiumDeps, userId: string, id: string): Promise<Project | Fail> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("JOB_NOT_FOUND");
  const p = await d.projects.get(id);
  if (!p) return fail("JOB_NOT_FOUND");
  if (p.user_id !== userId && !(await d.isAdmin?.(userId).catch(() => false))) return fail("JOB_NOT_FOUND");
  return p;
}

const isFail = (v: unknown): v is Fail => typeof v === "object" && v !== null && (v as Fail).ok === false;

export const UPLOAD_TTL_S = 3600;
export const DOWNLOAD_TTL_S = 600;

// ------------------------------------------------------------------ criar

export async function createProject(
  d: PremiumDeps,
  userId: string,
  req: { product: string; title?: string; files: { name: string; bytes: number; role?: string }[]; parentId?: string | null },
): Promise<Ok<{ projectId: string; uploads: string[] }> | Fail> {
  const product = req.product as ProjectProduct;
  if (!(PROJECT_PRODUCTS as readonly string[]).includes(product)) return fail("INVALID_JOB");
  const cat = await d.catalog();
  if (!cat.items.find((i) => i.id === product)?.enabled) return fail("TOOL_UNAVAILABLE");
  const [min, max] = fileLimits(product, cat);
  if (!Array.isArray(req.files) || req.files.length < min || req.files.length > max) return fail("INVALID_JOB");
  if (req.files.some((f) => !Number.isInteger(f?.bytes) || f.bytes < 1 || f.bytes > MAX_INPUT_BYTES)) return fail("TOO_LARGE");
  if (req.files.reduce((a, f) => a + f.bytes, 0) > 3 * 1024 ** 3) return fail("TOO_LARGE");

  let parent: Project | null = null;
  if (req.parentId) {
    const p = await owned(d, userId, req.parentId);
    if (isFail(p)) return p;
    parent = p;
  }
  const id = d.newId?.() ?? randomUUID();
  const inputs = req.files.map((_, i) => `cofre/proj/${id}/${String(i).padStart(2, "0")}`);
  await d.projects.insert({
    id,
    user_id: userId,
    product,
    title: safeFileName(req.title ?? req.files[0].name).slice(0, 80),
    params: {},
    inputs,
    input_meta: req.files.map((f) => ({ name: safeFileName(f.name), bytes: f.bytes, role: typeof f.role === "string" ? f.role.slice(0, 30) : undefined })),
    minutes: 0,
    parent_id: parent?.id ?? null,
  });
  return { ok: true, projectId: id, uploads: inputs.map((k, i) => d.objects.presign("PUT", k, UPLOAD_TTL_S, { contentLength: req.files[i].bytes })) };
}

// ------------------------------------------------------------------ prévia e trabalho final

/** Cria o job da prévia (preview=true) ou do trabalho final, com as entradas do Cofre do projeto. */
async function enqueueJob(d: PremiumDeps, userId: string, p: Project, rawParams: unknown, preview: boolean): Promise<Ok<{ jobId: string }> | Fail> {
  const tool = PRODUCT_TOOL[p.product];
  const parsed = parsePremiumParams(tool, { ...(rawParams as object), project_id: p.id, preview });
  if (!parsed) return fail("INVALID_JOB");
  if (parsed.params.durations.length !== p.inputs.length) return fail("INVALID_JOB");
  const cat = await d.catalog();
  const item = cat.items.find((i) => i.id === p.product);
  const minutes = Math.max(...parsed.params.durations) / 60;
  if (item?.max_minutes && minutes > (item.long_max_minutes ?? item.max_minutes) + 0.05) return fail("TOO_LONG", `O arquivo passa do limite deste recurso (${item.long_max_minutes ?? item.max_minutes} minutos).`);
  // entradas conferidas no armazenamento: existem e têm o tamanho declarado
  for (const [i, k] of p.inputs.entries()) {
    const h = await d.objects.head(k).catch(() => null);
    if (!h) return fail("INPUT_MISSING");
    if (p.input_meta[i] && h.size !== p.input_meta[i].bytes) return fail("INPUT_MISSING");
  }
  const { data, error } = await d.rpc("create_tool_job", {
    p_user: userId,
    p_tool: tool,
    p_params: parsed.params,
    p_inputs: p.inputs,
    p_credits: 0,
    p_retention_days: preview ? 1 : 30,
  });
  if (error) return fail(rpcCode(error));
  const jobId = (data as { job_id: string }).job_id;
  const pro = await d.isPro(userId).catch(() => false);
  try {
    await d.queue.enqueue(jobId, { kind: "tool", heavy: (tool === "mix_ia" || tool === "voice_final") && d.heavyAvailable(), priority: pro });
  } catch {
    await d.rpc("cancel_tool_job", { p_job_id: jobId, p_user: userId }).catch(() => {});
    return fail("CAPACITY");
  }
  // guarda as escolhas (sem o "preview") para o trabalho final e as revisões
  const keep: Record<string, unknown> = { ...parsed.params };
  delete keep.preview;
  delete keep.project_id;
  await d.projects.update(p.id, {
    params: keep,
    minutes: Math.round(minutes * 100) / 100,
    ...(preview ? { preview_job: jobId, status: "preview" } : { final_job: jobId, status: "processing" }),
  });
  return { ok: true, jobId };
}

export async function startPreview(d: PremiumDeps, userId: string, projectId: string, params: unknown): Promise<Ok<{ jobId: string }> | Fail> {
  const p = await owned(d, userId, projectId);
  if (isFail(p)) return p;
  const staff = await d.isAdmin?.(userId).catch(() => false);
  if (!staff && (await d.previewsToday(userId)) >= (await d.previewLimit())) return fail("RATE_LIMITED", "Você chegou ao limite de prévias grátis de hoje. Amanhã libera de novo, ou finalize um projeto.");
  return enqueueJob(d, userId, p, params, true);
}

/** O projeto está liberado (pedido pago dele, ou o Pacote compositor pago na produção de origem)? */
async function unlocked(d: PremiumDeps, p: Project): Promise<Order | null> {
  if (p.order_id) {
    const o = await d.orders.get(p.order_id);
    if (o?.status === "paid" && ordersUnlock(o.product).includes(p.product)) return o;
  }
  if (p.product === "voz_final" && p.parent_id) {
    const parent = await d.projects.get(p.parent_id);
    if (parent?.order_id) {
      const o = await d.orders.get(parent.order_id);
      if (o?.status === "paid" && o.product === "pacote_compositor") return o;
    }
  }
  return null;
}

export async function startFinal(d: PremiumDeps, userId: string, projectId: string, params?: unknown): Promise<Ok<{ jobId: string }> | Fail> {
  const p = await owned(d, userId, projectId);
  if (isFail(p)) return p;
  if (!(await unlocked(d, p))) return fail("PAYMENT_REQUIRED", "Finalize o pagamento para liberar o trabalho completo.");
  if (p.final_job) return { ok: true, jobId: p.final_job };
  return enqueueJob(d, userId, p, params ?? p.params, false);
}

/** Revisão (mix e voz): novo trabalho final com as escolhas novas, dentro do prazo do pedido. */
export async function revise(d: PremiumDeps, userId: string, projectId: string, params: unknown): Promise<Ok<{ jobId: string }> | Fail> {
  const p = await owned(d, userId, projectId);
  if (isFail(p)) return p;
  if (p.product !== "mix_ia" && p.product !== "voz_final") return fail("INVALID_JOB");
  const order = await unlocked(d, p);
  if (!order) return fail("PAYMENT_REQUIRED", "Finalize o pagamento para liberar as revisões.");
  const cat = await d.catalog();
  const days = cat.items.find((i) => i.id === p.product)?.revision_days ?? 7;
  if (order.paid_at && Date.now() - new Date(order.paid_at).getTime() > days * 86_400_000) {
    return fail("REVISION_CLOSED", `O prazo de revisões (${days} dias) terminou. Crie um projeto novo para mixar de novo.`);
  }
  if (p.revisions >= 30) return fail("RATE_LIMITED", "Limite de revisões deste projeto atingido.");
  const r = await enqueueJob(d, userId, { ...p, final_job: null }, params, false);
  if (r.ok) await d.projects.update(p.id, { revisions: p.revisions + 1 });
  return r;
}

// ------------------------------------------------------------------ preço e pagamento

export async function quote(d: PremiumDeps, userId: string, product: PremiumId, minutes: number): Promise<{ intro: PremiumQuote | null; regular: PremiumQuote | null; introAvailable: boolean }> {
  const cat = await d.catalog();
  const isPro = await d.isPro(userId).catch(() => false);
  const introAvailable = !(await d.introUsed(userId, product).catch(() => true));
  const intro = introAvailable ? quotePremium(cat, product, { introEligible: true, isPro, minutes }) : null;
  return { intro: intro?.intro ? intro : null, regular: quotePremium(cat, product, { introEligible: false, isPro, minutes }), introAvailable };
}

export async function checkout(
  d: PremiumDeps,
  userId: string,
  projectId: string,
  req: {
    product?: string;
    method: "brl" | "credits";
    useIntro: boolean;
    deviceId?: unknown;
    cpf?: unknown;
    fingerprint?: unknown;
    ip: string | null;
    email: string | null;
    emailConfirmed: boolean;
  },
): Promise<Ok<{ orderId: string; paid: boolean; initPoint: string | null; quote: PremiumQuote }> | Fail> {
  const p = await owned(d, userId, projectId);
  if (isFail(p)) return p;
  if (p.user_id !== userId) return fail("JOB_NOT_FOUND");
  // a produção pode ser paga como Pacote compositor (produção + voz finalizada); a mix paga pode pedir o engenheiro
  let product = p.product as PremiumId;
  if (req.product === "pacote_compositor" && p.product === "producao") product = "pacote_compositor";
  if (req.product === "eng_finaliza") {
    if (p.product !== "mix_ia" || !(await unlocked(d, p))) return fail("PAYMENT_REQUIRED", "O engenheiro finaliza a partir de uma mix da IA já paga.");
    product = "eng_finaliza";
  }
  if (!(PREMIUM_IDS as readonly string[]).includes(product)) return fail("INVALID_JOB");
  const cat = await d.catalog();
  const isPro = await d.isPro(userId).catch(() => false);
  const minutes = p.minutes || 0;

  // admin: tudo grátis — pedido pago na hora (o banco ignora o débito da conta da equipe)
  if (await d.isAdmin?.(userId).catch(() => false)) {
    const list = quotePremium(cat, product, { introEligible: false, isPro: false, minutes });
    if (!list) return fail("TOOL_UNAVAILABLE", "Este recurso não está disponível para essa duração agora.");
    const { data, error } = await d.rpc("create_premium_order", {
      p_user: userId,
      p_project: p.id,
      p_product: product,
      p_method: "credits",
      p_price: 0,
      p_list_price: list.list_price_brl,
      p_credits: 1,
      p_intro: false,
      p_pro_discount: false,
      p_device_hash: null,
      p_cpf_hash: null,
      p_net_hash: null,
    });
    if (error) return fail(rpcCode(error));
    const o = data as { id: string };
    if (product !== "eng_finaliza") await startFinal(d, userId, p.id).catch(() => null);
    return { ok: true, orderId: o.id, paid: true, initPoint: null, quote: { ...list, price_brl: 0, credits: 0, intro: false, pro_discount: false } };
  }

  let ids: { deviceHash: string; cpfHash: string; netHash: string | null } | null = null;
  let cpfDigits: string | null = null;
  if (req.useIntro) {
    const id = introIdentity(d.introSecret(), { deviceId: req.deviceId, cpf: req.cpf, fingerprint: req.fingerprint, ip: req.ip, email: req.email, emailConfirmed: req.emailConfirmed });
    if (!id.ok) return fail("INTRO_" + id.reason, INTRO_REASON_MESSAGE[id.reason]);
    ids = id.id;
    cpfDigits = typeof req.cpf === "string" ? req.cpf.replace(/\D/g, "") : null;
  }
  const q = quotePremium(cat, product, { introEligible: req.useIntro, isPro, minutes });
  if (!q) return fail("TOOL_UNAVAILABLE", "Este recurso não está disponível para essa duração agora.");
  if (req.useIntro && !q.intro) return fail("INTRO_UNAVAILABLE", "Este recurso não tem preço de primeira experiência.");
  if (req.method === "credits" && q.credits === null) return fail("INVALID_JOB", "Este recurso é pago em reais (PIX ou cartão).");

  const { data, error } = await d.rpc("create_premium_order", {
    p_user: userId,
    p_project: p.id,
    p_product: product,
    p_method: req.method,
    p_price: q.price_brl,
    p_list_price: q.list_price_brl,
    p_credits: q.credits ?? 0,
    p_intro: q.intro,
    p_pro_discount: q.pro_discount,
    p_device_hash: ids?.deviceHash ?? null,
    p_cpf_hash: ids?.cpfHash ?? null,
    p_net_hash: ids?.netHash ?? null,
  });
  if (error) {
    const code = rpcCode(error);
    if (code === "INTRO_USED") return fail("INTRO_USED", INTRO_REASON_MESSAGE.INTRO_USED);
    if (code === "ALREADY_PAID") return fail("ALREADY_PAID", "Este projeto já está pago.");
    return fail(code);
  }
  const order = data as { id: string; status: string };
  if (order.status === "paid") {
    await startFinal(d, userId, p.id).catch(() => null);
    return { ok: true, orderId: order.id, paid: true, initPoint: null, quote: q };
  }
  const item = cat.items.find((i) => i.id === product)!;
  try {
    const c = await d.checkout({ userId, email: req.email, orderId: order.id, title: `Mix Pro — ${item.name}`, price: q.price_brl, returnPath: `/premium/${p.id}`, cpf: cpfDigits });
    return { ok: true, orderId: order.id, paid: false, initPoint: c.initPoint, quote: q };
  } catch {
    return fail("CHECKOUT_FAILED", "Não foi possível abrir o pagamento agora. Tente de novo em instantes.");
  }
}

// ------------------------------------------------------------------ andamento

export type JobView = { id: string; status: string; progress: number; errorCode: string | null; message: string | null; measures: Record<string, unknown> | null; outputs: { name: string; bytes: number; url: string }[] };

async function jobView(d: PremiumDeps, userId: string, id: string | null): Promise<JobView | null> {
  if (!id) return null;
  const { data } = await d.rpc("get_tool_job", { p_job_id: id });
  const j = data as Job | null;
  if (!j || j.user_id !== userId) return null;
  const alive = j.status === "done" && new Date(j.expires_at).getTime() > Date.now();
  return {
    id: j.id,
    status: j.status,
    progress: j.progress,
    errorCode: j.error_code,
    message: j.error_code ? exportErrorInfo(j.error_code).message : null,
    measures: j.measures,
    outputs: alive && j.outputs ? j.outputs.map((o) => ({ name: o.name, bytes: o.bytes, url: d.objects.presign("GET", o.key, DOWNLOAD_TTL_S, { downloadName: o.name.replace(/[^A-Za-z0-9._-]/g, "_") }) })) : [],
  };
}

export async function projectStatus(d: PremiumDeps, userId: string, projectId: string) {
  const p = await owned(d, userId, projectId);
  if (isFail(p)) return p;
  let project = p;
  const order = await unlocked(d, p);
  // pago pelo Mercado Pago (webhook) e ainda sem o trabalho final: começa agora
  if (order && !p.final_job && p.user_id === userId) {
    const r = await startFinal(d, userId, p.id);
    if (r.ok) project = { ...p, final_job: r.jobId, status: "processing" };
  }
  const [preview, final] = await Promise.all([jobView(d, p.user_id, project.preview_job), jobView(d, p.user_id, project.final_job)]);
  if (final?.status === "done" && project.status !== "delivered") await d.projects.update(project.id, { status: "delivered" });
  else if (!final && preview?.status === "done" && project.status === "preview") await d.projects.update(project.id, { status: "preview_ready" });
  else if ((final ?? preview)?.status === "failed" && ["preview", "processing"].includes(project.status)) await d.projects.update(project.id, { status: "failed" });
  const pendingOrder = !order && project.order_id ? await d.orders.get(project.order_id) : null;
  return {
    ok: true as const,
    project: { id: project.id, product: project.product, title: project.title, status: final?.status === "done" ? "delivered" : project.status, minutes: project.minutes, revisions: project.revisions, params: project.params, inputMeta: project.input_meta, parentId: project.parent_id, expiresAt: project.expires_at },
    paid: Boolean(order),
    owner: p.user_id === userId,
    order: order ?? pendingOrder,
    preview,
    final,
  };
}
