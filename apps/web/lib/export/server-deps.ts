import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { wifConfigFromEnv, wifTokenSource } from "./gcp-wif";
import { CloudTasksQueue, cloudTasksConfigFromEnv, serviceAccountTokenSource, type TokenSource } from "./queue-cloud-tasks";
import type { QueueService } from "./queue";
import { R2Client, r2ConfigFromEnv } from "./r2";
import type { Deps, Fail } from "./server-jobs";
import { parsePremium, parseToolCosts } from "@mixpro/contracts";
import { createHash } from "node:crypto";
import type { ToolDeps } from "@/lib/tools/server-tools";

/** Token do Google em cache entre requisições da mesma instância (dura ~1 h). */
let tokenCache: { json: string; source: TokenSource } | null = null;
const wifCache: { v: { token: string; exp: number } | null } = { v: null };

/**
 * Como a Vercel se autentica no Google: chave JSON (GCP_SERVICE_ACCOUNT_JSON) se existir; senão,
 * sem chave, pelo OIDC da Vercel (GCP_WIF_PROVIDER), com o token do cabeçalho desta requisição.
 */
function tokenSource(req?: Request): TokenSource {
  const json = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (json) {
    if (tokenCache?.json !== json) tokenCache = { json, source: serviceAccountTokenSource(json) };
    return tokenCache.source;
  }
  const wif = wifConfigFromEnv();
  if (!wif) throw new Error("autenticação do Google não configurada");
  return wifTokenSource(wif, () => req?.headers.get("x-vercel-oidc-token") ?? process.env.VERCEL_OIDC_TOKEN ?? null, fetch, Date.now, wifCache);
}

/**
 * A fila só é montada quando usada (criar a tarefa). Assim, status, cancelamento e download de jobs
 * existentes continuam funcionando mesmo se a configuração do Google estiver incompleta.
 */
function lazyQueue(req?: Request): QueueService {
  let q: CloudTasksQueue | null = null;
  const get = () => {
    if (!q) q = new CloudTasksQueue(cloudTasksConfigFromEnv(), tokenSource(req));
    return q;
  };
  return {
    mode: "push",
    enqueue: (jobId, opts) => get().enqueue(jobId, opts),
    dequeue: () => get().dequeue(),
    // fila por HTTP: o consumo é o próprio Cloud Tasks (estas lançam QueueModeError)
    ack: () => get().ack(),
    fail: () => get().fail(),
    retry: () => get().retry(),
  };
}

/**
 * Dependências reais das rotas /api/export/jobs: banco (RPCs com service role, só aqui no servidor),
 * R2 e Cloud Tasks.
 */
/** `req`: a requisição atual (traz o token OIDC da Vercel, usado só para criar a tarefa na fila). */
export function exportDeps(req?: Request): Deps {
  const r2 = new R2Client(r2ConfigFromEnv());
  const admin = supabaseAdmin();
  return {
    rpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };
    },
    objects: {
      presign: (method, key, expiresS, opts) => r2.presign(method, key, expiresS, opts),
      head: (key) => r2.head(key),
      delete: (key) => r2.delete(key),
    },
    queue: lazyQueue(req),
  };
}

/**
 * Diagnóstico (só admin): consegue o token do Google pelo mesmo caminho da fila? Devolve só a etapa e o
 * status HTTP da falha, nunca valores.
 */
export async function testGoogleAuth(req: Request): Promise<{ ok: true } | { ok: false; etapa: string; status: number; motivo: string }> {
  try {
    await tokenSource(req)();
    return { ok: true };
  } catch (e) {
    const x = e as { step?: string; status?: number; message?: string; detail?: string };
    return { ok: false, etapa: x.step ?? (x.message?.slice(0, 80) || "desconhecida"), status: x.status ?? 0, motivo: x.detail ?? "" };
  }
}

/** Dependências das rotas de ferramentas: as da exportação + preços (Admin) + Plano Pro. */
export function toolDeps(req?: Request): ToolDeps {
  const base = exportDeps(req);
  const admin = supabaseAdmin();
  return {
    ...base,
    costs: async () => {
      const { data } = await admin.from("system_settings").select("value").eq("key", "tool_credit_costs").maybeSingle();
      return parseToolCosts(data?.value);
    },
    stemsAvailable: () => Boolean(process.env.EXPORT_STEMS_URL),
    isPro: async (userId) => {
      const { data, error } = await admin.rpc("is_pro", { p_user: userId });
      return !error && data === true;
    },
  };
}

/** O servidor está pronto para receber jobs novos (R2 e Google configurados)? */
export function exportServerConfigured(): boolean {
  try {
    r2ConfigFromEnv();
    cloudTasksConfigFromEnv();
    return Boolean(process.env.GCP_SERVICE_ACCOUNT_JSON) || wifConfigFromEnv() !== null;
  } catch {
    return false;
  }
}

/** Falha de regra → resposta JSON com mensagem amigável, código fechado e se o aparelho pode assumir. */
export function failResponse(f: Fail) {
  return Response.json({ error: f.message, code: f.code, device: f.device }, { status: f.status });
}

/** Configuração incompleta: o servidor de exportação não está disponível; o app usa o aparelho. */
export function unavailableResponse() {
  return Response.json({ error: "O processamento no servidor não está disponível agora. Você pode processar neste aparelho.", code: "CAPACITY", device: true }, { status: 503 });
}

/** Dependências do fluxo premium: as da exportação + banco (projetos, pedidos), catálogo e pagamento. */
export function premiumDeps(req?: Request): import("@/lib/premium/server").PremiumDeps {
  const base = exportDeps(req);
  const admin = supabaseAdmin();
  const r2 = new R2Client(r2ConfigFromEnv());
  return {
    rpc: base.rpc,
    queue: base.queue,
    objects: {
      ...base.objects,
      copy: async (from, to) => {
        const chunks: Buffer[] = [];
        for await (const c of r2.read(from)) chunks.push(c as Buffer);
        await r2.put(to, new Uint8Array(Buffer.concat(chunks)));
      },
    },
    catalog: async () => {
      const { data } = await admin.from("system_settings").select("value").eq("key", "premium_products").maybeSingle();
      return parsePremium(data?.value);
    },
    isPro: async (userId) => {
      const { data, error } = await admin.rpc("is_pro", { p_user: userId });
      return !error && data === true;
    },
    projects: {
      get: async (id) => {
        const { data } = await admin.from("premium_projects").select("*").eq("id", id).maybeSingle();
        return (data as import("@/lib/premium/server").Project | null) ?? null;
      },
      insert: async (p) => {
        const { error } = await admin.from("premium_projects").insert(p);
        if (error) throw new Error("premium_projects insert");
      },
      update: async (id, patch) => {
        await admin.from("premium_projects").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      },
    },
    orders: {
      get: async (id) => {
        const { data } = await admin.from("premium_orders").select("id,product,status,price_brl,list_price_brl,intro,method,paid_at").eq("id", id).maybeSingle();
        return (data as import("@/lib/premium/server").Order | null) ?? null;
      },
    },
    previewsToday: async (userId) => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { count } = await admin.from("tool_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).not("project_id", "is", null).eq("params->>preview", "true").gte("created_at", since);
      return count ?? 0;
    },
    previewLimit: async () => {
      const { data } = await admin.from("system_settings").select("value").eq("key", "premium_preview_per_day").maybeSingle();
      const n = Number(data?.value);
      return Number.isInteger(n) && n >= 0 ? n : 6;
    },
    introUsed: async (userId, product) => {
      const { count } = await admin.from("intro_claims").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("product", product).neq("status", "released");
      return (count ?? 0) > 0;
    },
    checkout: async (o) => {
      const { createCheckout } = await import("@/lib/payments");
      const c = await createCheckout({ userId: o.userId, email: o.email, packId: `prem:${o.orderId}`, title: o.title, quantity: 1, unitPrice: o.price, credits: 0, returnPath: o.returnPath, payerCpf: o.cpf });
      return { initPoint: c.initPoint };
    },
    introSecret: () => process.env.INTRO_HASH_SECRET || createHash("sha256").update(`intro|${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`).digest("hex"),
    heavyAvailable: () => Boolean(process.env.EXPORT_STEMS_URL),
  };
}
