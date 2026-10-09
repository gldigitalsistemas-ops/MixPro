/**
 * Fila de produção: Google Cloud Tasks entregando `POST /run {job_id}` ao Cloud Run com token OIDC
 * (o serviço fica fechado ao público: só a conta `export-invoker` chama).
 *
 * Autenticação de quem cria a tarefa (a Vercel): chave de conta de serviço em GCP_SERVICE_ACCOUNT_JSON
 * (JWT assinado trocado por um token de acesso). Para Workload Identity Federation (sem chave), troque
 * apenas `TokenSource`: o resto não muda.
 *
 * Variáveis: GCP_PROJECT_ID, GCP_REGION, EXPORT_TASKS_QUEUE, EXPORT_SERVICE_URL, GCP_SERVICE_ACCOUNT_JSON,
 * EXPORT_INVOKER_EMAIL (opcional; padrão: export-invoker@<projeto>.iam.gserviceaccount.com).
 * Nada disso aparece em log ou resposta de erro.
 */
import { createSign } from "node:crypto";
import { QueueModeError, type EnqueueOptions, type QueueMessage, type QueueService } from "./queue";

export type TokenSource = () => Promise<string>;

export type CloudTasksConfig = {
  projectId: string;
  region: string;
  queue: string;
  /** URL do serviço (sem /run no final). */
  serviceUrl: string;
  /** Serviço com mais CPU (separação de faixas); ausente = o mesmo serviço. */
  heavyServiceUrl?: string;
  /** Fila do Plano Pro (prioridade); ausente = a mesma fila. */
  priorityQueue?: string;
  invokerEmail: string;
  /** Prazo de resposta do serviço por tentativa (s). O Cloud Tasks aceita até 1800. */
  dispatchDeadlineS?: number;
};

export function cloudTasksConfigFromEnv(env: Record<string, string | undefined> = process.env): CloudTasksConfig {
  const projectId = env.GCP_PROJECT_ID ?? "";
  const region = env.GCP_REGION ?? "";
  const queue = env.EXPORT_TASKS_QUEUE ?? "";
  const serviceUrl = (env.EXPORT_SERVICE_URL ?? "").replace(/\/+$/, "");
  if (!projectId || !region || !queue || !serviceUrl) throw new Error("Cloud Tasks não configurado (GCP_PROJECT_ID, GCP_REGION, EXPORT_TASKS_QUEUE, EXPORT_SERVICE_URL)");
  const heavyServiceUrl = (env.EXPORT_STEMS_URL ?? "").replace(/\/+$/, "") || undefined;
  const priorityQueue = env.EXPORT_TASKS_QUEUE_PRO || undefined;
  return { projectId, region, queue, serviceUrl, heavyServiceUrl, priorityQueue, invokerEmail: env.EXPORT_INVOKER_EMAIL || `export-invoker@${projectId}.iam.gserviceaccount.com` };
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** Token de acesso a partir da chave JSON de uma conta de serviço (fluxo "JWT bearer" do OAuth do Google). */
export function serviceAccountTokenSource(json: string, fetchFn: typeof fetch = fetch, now: () => number = () => Date.now()): TokenSource {
  let cached: { token: string; exp: number } | null = null;
  return async () => {
    if (cached && cached.exp - 60_000 > now()) return cached.token;
    let key: { client_email: string; private_key: string; token_uri?: string };
    try {
      key = JSON.parse(json);
    } catch {
      throw new Error("GCP_SERVICE_ACCOUNT_JSON inválido");
    }
    if (!key.client_email || !key.private_key) throw new Error("GCP_SERVICE_ACCOUNT_JSON incompleto");
    const iat = Math.floor(now() / 1000);
    const uri = key.token_uri ?? "https://oauth2.googleapis.com/token";
    const claims = { iss: key.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: uri, iat, exp: iat + 3600 };
    const head = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
    const sig = createSign("RSA-SHA256").update(head).sign(key.private_key);
    const res = await fetchFn(uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${b64url(sig)}` }),
    });
    if (!res.ok) throw new Error(`token do Google recusado (HTTP ${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("resposta de token sem access_token");
    cached = { token: body.access_token, exp: now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}

/** Erro da fila só com o status HTTP (nunca a resposta, que pode ecoar nomes e URLs). */
export class QueueError extends Error {
  constructor(public status: number) {
    super(`Cloud Tasks: HTTP ${status}`);
  }
}

export class CloudTasksQueue implements QueueService {
  readonly mode = "push" as const;
  constructor(
    private cfg: CloudTasksConfig,
    private token: TokenSource,
    private fetchFn: typeof fetch = fetch,
  ) {}

  /**
   * O nome da tarefa leva o id do job: criar de novo (clique repetido, retentativa da rota) devolve
   * ALREADY_EXISTS e é tratado como sucesso, sem duplicar o processamento.
   */
  async enqueue(jobId: string, opts: EnqueueOptions = {}) {
    const { projectId, region, invokerEmail } = this.cfg;
    const queue = opts.priority && this.cfg.priorityQueue ? this.cfg.priorityQueue : this.cfg.queue;
    const serviceUrl = opts.heavy && this.cfg.heavyServiceUrl ? this.cfg.heavyServiceUrl : this.cfg.serviceUrl;
    const path = opts.kind === "tool" ? "/tool" : "/run";
    const parent = `projects/${projectId}/locations/${region}/queues/${queue}`;
    const name = `${parent}/tasks/${opts.kind === "tool" ? "tool" : "job"}-${jobId}`;
    const body = {
      task: {
        name,
        // separação de faixas pode levar mais (o Cloud Tasks aceita até 30 min)
        dispatchDeadline: `${opts.heavy ? 1800 : (this.cfg.dispatchDeadlineS ?? 900)}s`,
        httpRequest: {
          httpMethod: "POST",
          url: `${serviceUrl}${path}`,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify({ job_id: jobId })).toString("base64"),
          oidcToken: { serviceAccountEmail: invokerEmail, audience: serviceUrl },
        },
      },
    };
    const res = await this.fetchFn(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 409) throw new QueueError(res.status);
    return { id: name };
  }

  async dequeue(): Promise<QueueMessage | null> {
    throw new QueueModeError("dequeue");
  }
  async ack(): Promise<void> {
    throw new QueueModeError("ack");
  }
  async fail(): Promise<"requeued" | "dead"> {
    throw new QueueModeError("fail");
  }
  async retry(): Promise<void> {
    throw new QueueModeError("retry");
  }
}
