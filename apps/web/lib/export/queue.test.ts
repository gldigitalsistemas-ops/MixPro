import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { LocalQueue, QueueModeError } from "./queue";
import { CloudTasksQueue, cloudTasksConfigFromEnv, serviceAccountTokenSource, QueueError } from "./queue-cloud-tasks";

const JOB = "11111111-2222-4333-8444-555555555555";

test("LocalQueue: enfileirar, pegar, confirmar", async () => {
  const q = new LocalQueue();
  const a = await q.enqueue(JOB);
  assert.deepEqual(await q.enqueue(JOB), a, "enfileirar o mesmo job não duplica");
  const m = await q.dequeue();
  assert.equal(m?.jobId, JOB);
  assert.equal(m?.attempts, 1);
  assert.equal(await q.dequeue(), null);
  await q.ack(m!.id);
  assert.deepEqual(q.sizes(), { ready: 0, running: 0, dead: 0 });
});

test("LocalQueue: erro passageiro volta à fila até o limite; erro definitivo vai direto para as mortas", async () => {
  const q = new LocalQueue(3);
  await q.enqueue(JOB);
  for (let i = 1; i <= 2; i++) {
    const m = await q.dequeue();
    assert.equal(m?.attempts, i);
    assert.equal(await q.fail(m!.id, true), "requeued");
  }
  const third = await q.dequeue();
  assert.equal(third?.attempts, 3);
  assert.equal(await q.fail(third!.id, true), "dead", "3 tentativas: não fica em loop");
  assert.deepEqual(q.sizes(), { ready: 0, running: 0, dead: 1 });

  await q.retry(third!.id);
  assert.equal((await q.dequeue())?.attempts, 1, "retry recomeça a contagem");

  const q2 = new LocalQueue(3);
  await q2.enqueue(JOB);
  const m2 = await q2.dequeue();
  assert.equal(await q2.fail(m2!.id, false), "dead", "erro permanente não tenta de novo");
});

const cfg = { projectId: "meu-projeto", region: "us-central1", queue: "exports", serviceUrl: "https://svc.run.app", invokerEmail: "export-invoker@meu-projeto.iam.gserviceaccount.com" };

test("CloudTasksQueue: cria a tarefa com nome determinístico, OIDC e corpo só com o job_id", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const q = new CloudTasksQueue(cfg, async () => "tok", fetchFn);
  const r = await q.enqueue(JOB);
  assert.equal(r.id, `projects/meu-projeto/locations/us-central1/queues/exports/tasks/job-${JOB}`);
  assert.equal(seen!.url, "https://cloudtasks.googleapis.com/v2/projects/meu-projeto/locations/us-central1/queues/exports/tasks");
  assert.equal((seen!.init.headers as Record<string, string>).authorization, "Bearer tok");
  const body = JSON.parse(seen!.init.body as string).task;
  assert.equal(body.httpRequest.url, "https://svc.run.app/run");
  assert.deepEqual(body.httpRequest.oidcToken, { serviceAccountEmail: cfg.invokerEmail, audience: "https://svc.run.app" });
  assert.deepEqual(JSON.parse(Buffer.from(body.httpRequest.body, "base64").toString()), { job_id: JOB });
});

test("CloudTasksQueue: tarefa repetida (409) é sucesso; outros erros não vazam a resposta", async () => {
  const dup = new CloudTasksQueue(cfg, async () => "t", (async () => new Response("segredo", { status: 409 })) as unknown as typeof fetch);
  await dup.enqueue(JOB);
  const bad = new CloudTasksQueue(cfg, async () => "t", (async () => new Response("segredo-do-google", { status: 403 })) as unknown as typeof fetch);
  await assert.rejects(bad.enqueue(JOB), (e: Error) => e instanceof QueueError && e.status === 403 && !e.message.includes("segredo"));
});

test("CloudTasksQueue é 'push': dequeue, ack, fail e retry não se aplicam", async () => {
  const q = new CloudTasksQueue(cfg, async () => "t");
  assert.equal(q.mode, "push");
  await assert.rejects(q.dequeue(), QueueModeError);
  await assert.rejects(q.ack(), QueueModeError);
  await assert.rejects(q.fail(), QueueModeError);
  await assert.rejects(q.retry(), QueueModeError);
});

test("configuração: padrão do e-mail do invocador e erro sem valores", () => {
  const c = cloudTasksConfigFromEnv({ GCP_PROJECT_ID: "p", GCP_REGION: "r", EXPORT_TASKS_QUEUE: "q", EXPORT_SERVICE_URL: "https://x.run.app/" });
  assert.equal(c.serviceUrl, "https://x.run.app");
  assert.equal(c.invokerEmail, "export-invoker@p.iam.gserviceaccount.com");
  assert.throws(() => cloudTasksConfigFromEnv({ GCP_PROJECT_ID: "p-secreto" }), (e: Error) => !e.message.includes("secreto"));
});

test("token da conta de serviço: JWT RS256 válido, em cache e erro sem vazar a chave", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const json = JSON.stringify({ client_email: "sa@p.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  let calls = 0;
  let assertion = "";
  const fetchFn = (async (_u: string, init: RequestInit) => {
    calls++;
    assertion = (init.body as URLSearchParams).get("assertion")!;
    return new Response(JSON.stringify({ access_token: "abc", expires_in: 3600 }), { status: 200 });
  }) as unknown as typeof fetch;
  let t = 1_000_000_000_000;
  const src = serviceAccountTokenSource(json, fetchFn, () => t);
  assert.equal(await src(), "abc");
  assert.equal(await src(), "abc");
  assert.equal(calls, 1, "o token fica em cache");
  const [h, c, s] = assertion.split(".");
  assert.equal(JSON.parse(Buffer.from(c, "base64url").toString()).iss, "sa@p.iam.gserviceaccount.com");
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url")));
  t += 3_700_000;
  await src();
  assert.equal(calls, 2, "vencido: renova");

  const broken = serviceAccountTokenSource('{"client_email":"x","private_key":"CHAVE-PRIVADA-SECRETA"}', fetchFn, () => t);
  await assert.rejects(broken(), (e: Error) => !e.message.includes("SECRETA"));
});
