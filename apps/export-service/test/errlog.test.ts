import { test } from "node:test";
import assert from "node:assert/strict";
import { makeErrorReporter } from "../src/errlog";

test("falha do servidor vai para os Logs de erros: recurso, código, causa, etapa e a pessoa afetada", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const report = makeErrorReporter({
    supabaseUrl: "https://x.supabase.co/",
    serviceKey: "chave",
    fetchFn: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch,
  });
  await report({
    jobId: "a6ebe6d8-734c-44be-ab8c-19c00d049ce2",
    tool: "compose",
    userId: "11111111-1111-1111-1111-111111111111",
    projectId: "22222222-2222-2222-2222-222222222222",
    code: "INTERNAL",
    error: new Error("validade da URL deve ficar entre 1 e 3600 s"),
    progress: 28,
    attempt: 3,
    retrying: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/app_errors");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.severity, "erro");
  assert.equal(body.area, "servidor:compose");
  assert.equal(body.message, "compose: INTERNAL");
  assert.match(body.cause, /3600 s/);
  assert.equal(body.route, "/premium/22222222-2222-2222-2222-222222222222");
  assert.deepEqual(body.context, { job_id: "a6ebe6d8-734c-44be-ab8c-19c00d049ce2", codigo: "INTERNAL", progresso: 28, tentativa: 3 });
  assert.ok(body.client_id.length >= 8 && body.fingerprint.length <= 64);
});

test("se o registro falhar, o job segue (nada é lançado)", async () => {
  const report = makeErrorReporter({ supabaseUrl: "https://x.supabase.co", serviceKey: "k", fetchFn: (async () => { throw new Error("rede"); }) as unknown as typeof fetch });
  await report({ jobId: "j", tool: "compose", userId: null, projectId: null, code: "TIMEOUT", error: null, progress: null, attempt: 1, retrying: true });
});
