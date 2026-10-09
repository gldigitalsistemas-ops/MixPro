/**
 * Acesso ao Google SEM chave guardada (Workload Identity Federation com o OIDC da Vercel).
 *
 * A cada requisição a Vercel entrega um token OIDC de curta duração no cabeçalho `x-vercel-oidc-token`
 * (precisa estar ligado em Project Settings → Security → Secure Backend Access with OIDC Federation).
 * Ele é trocado no STS do Google por um token federado, que então "vira" a conta export-enqueuer
 * (generateAccessToken). O resultado fica em cache até perto de vencer.
 *
 * Variáveis: GCP_WIF_PROVIDER (//iam.googleapis.com/projects/<número>/locations/global/
 * workloadIdentityPools/<pool>/providers/<provider>) e EXPORT_ENQUEUER_EMAIL (opcional).
 */
import type { TokenSource } from "./queue-cloud-tasks";

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export class WifError extends Error {
  constructor(
    public step: "oidc" | "sts" | "impersonate",
    public status = 0,
    /** Motivo devolvido pelo Google (texto curto, sem segredos); só aparece no diagnóstico do admin. */
    public detail = "",
  ) {
    super(`WIF ${step}${status ? `: HTTP ${status}` : ""}`);
  }
}

export type WifConfig = { provider: string; serviceAccount: string };

export function wifConfigFromEnv(env: Record<string, string | undefined> = process.env): WifConfig | null {
  // tolera o que costuma vir colado junto no painel: espaços, aspas e o próprio nome da variável
  const provider = (env.GCP_WIF_PROVIDER ?? "").trim().replace(/^GCP_WIF_PROVIDER=/, "").replace(/^["']|["']$/g, "").trim();
  if (!/^\/\/iam\.googleapis\.com\/projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(provider)) return null;
  const project = env.GCP_PROJECT_ID ?? "";
  const serviceAccount = env.EXPORT_ENQUEUER_EMAIL || (project ? `export-enqueuer@${project}.iam.gserviceaccount.com` : "");
  return serviceAccount ? { provider, serviceAccount } : null;
}

type Cached = { token: string; exp: number };

/** `oidcToken`: devolve o token OIDC da requisição atual (cabeçalho) ou null. */
export function wifTokenSource(cfg: WifConfig, oidcToken: () => string | null, fetchFn: typeof fetch = fetch, now: () => number = () => Date.now(), cache: { v: Cached | null } = { v: null }): TokenSource {
  return async () => {
    if (cache.v && cache.v.exp - 60_000 > now()) return cache.v.token;
    const subject = oidcToken();
    if (!subject) throw new WifError("oidc");

    const sts = await fetchFn("https://sts.googleapis.com/v1/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: cfg.provider,
        scope: SCOPE,
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        subjectToken: subject,
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      }),
    });
    if (!sts.ok) {
      const body = (await sts.json().catch(() => null)) as { error_description?: string } | null;
      throw new WifError("sts", sts.status, String(body?.error_description ?? "").slice(0, 300));
    }
    const federated = ((await sts.json()) as { access_token?: string }).access_token;
    if (!federated) throw new WifError("sts");

    const imp = await fetchFn(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(cfg.serviceAccount)}:generateAccessToken`, {
      method: "POST",
      headers: { authorization: `Bearer ${federated}`, "content-type": "application/json" },
      body: JSON.stringify({ scope: [SCOPE], lifetime: "3600s" }),
    });
    if (!imp.ok) {
      const body = (await imp.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new WifError("impersonate", imp.status, String(body?.error?.message ?? "").slice(0, 300));
    }
    const body = (await imp.json()) as { accessToken?: string; expireTime?: string };
    if (!body.accessToken) throw new WifError("impersonate");
    const exp = body.expireTime ? Date.parse(body.expireTime) : now() + 3_600_000;
    cache.v = { token: body.accessToken, exp: Number.isFinite(exp) ? exp : now() + 3_600_000 };
    return cache.v.token;
  };
}

/** Campos públicos do token OIDC da Vercel (sem a assinatura), para o diagnóstico do admin. */
export function oidcClaims(token: string | null): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const c = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const pick = ["iss", "aud", "sub", "owner", "project", "environment", "exp"];
    return Object.fromEntries(pick.filter((k) => k in c).map((k) => [k, c[k]]));
  } catch {
    return { erro: "token ilegível" };
  }
}
