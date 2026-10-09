import { test } from "node:test";
import assert from "node:assert/strict";
import { wifConfigFromEnv, wifTokenSource, WifError } from "./gcp-wif";

const PROVIDER = "//iam.googleapis.com/projects/729184756608/locations/global/workloadIdentityPools/vercel/providers/vercel";
const cfg = { provider: PROVIDER, serviceAccount: "export-enqueuer@mixpro-export.iam.gserviceaccount.com" };

test("configuração: provedor válido e conta padrão; inválido ou ausente → null", () => {
  assert.deepEqual(wifConfigFromEnv({ GCP_WIF_PROVIDER: PROVIDER, GCP_PROJECT_ID: "mixpro-export" }), cfg);
  assert.equal(wifConfigFromEnv({ GCP_WIF_PROVIDER: "https://evil.example/x", GCP_PROJECT_ID: "p" }), null);
  assert.equal(wifConfigFromEnv({}), null);
});

test("troca o token da Vercel no STS, assume a conta e guarda em cache até perto de vencer", async () => {
  const calls: { url: string; body: Record<string, unknown>; auth?: string }[] = [];
  let t = 1_000_000;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string), auth: (init.headers as Record<string, string>).authorization });
    if (url.startsWith("https://sts.googleapis.com")) return Response.json({ access_token: "federado" });
    return Response.json({ accessToken: "ya29.final", expireTime: new Date(t + 3_600_000).toISOString() });
  }) as unknown as typeof fetch;
  const src = wifTokenSource(cfg, () => "oidc-da-vercel", fetchFn, () => t);
  assert.equal(await src(), "ya29.final");
  assert.equal(await src(), "ya29.final");
  assert.equal(calls.length, 2, "segunda chamada vem do cache");
  assert.equal(calls[0].body.audience, PROVIDER);
  assert.equal(calls[0].body.subjectToken, "oidc-da-vercel");
  assert.ok(calls[1].url.includes("export-enqueuer%40mixpro-export.iam.gserviceaccount.com:generateAccessToken"));
  assert.equal(calls[1].auth, "Bearer federado");
  t += 3_600_000;
  await src();
  assert.equal(calls.length, 4, "vencido: renova");
});

test("sem o token da Vercel ou com recusa do Google: erro só com a etapa e o status (nada da resposta)", async () => {
  await assert.rejects(wifTokenSource(cfg, () => null)(), (e: WifError) => e.step === "oidc");
  const sts = (async () => new Response("detalhe-secreto", { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(wifTokenSource(cfg, () => "x", sts)(), (e: WifError) => e.step === "sts" && e.status === 403 && !e.message.includes("secreto"));
  const imp = (async (url: string) => (url.startsWith("https://sts") ? Response.json({ access_token: "f" }) : new Response("x", { status: 403 }))) as unknown as typeof fetch;
  await assert.rejects(wifTokenSource(cfg, () => "x", imp)(), (e: WifError) => e.step === "impersonate" && e.status === 403);
});
