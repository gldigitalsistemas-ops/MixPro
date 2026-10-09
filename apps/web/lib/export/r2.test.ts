/**
 * Teste do cliente R2 contra o bucket REAL de exportação (privado, só objetos com prefixo _teste/).
 * Lê as chaves de apps/web/.env.local (ignorado pelo git). Pula se não houver chaves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { R2Client, r2ConfigFromEnv } from "./r2";

const envFile = fileURLToPath(new URL("../../.env.local", import.meta.url));
const env: Record<string, string | undefined> = { ...process.env };
if (existsSync(envFile)) {
  for (const l of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
}
const configured = Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);
const skip = configured ? false : "sem chaves do R2";

const key = (n: string) => `_teste/${Date.now()}-${n}`;

test("PUT por URL pré-assinada com tamanho fixo, HEAD, GET por URL pré-assinada e leitura em fluxo", { skip }, async () => {
  const r2 = new R2Client(r2ConfigFromEnv(env));
  const k = key("a.bin");
  const data = new Uint8Array(1000).map((_, i) => i % 251);
  try {
    // tamanho declarado diferente do real: o R2 recusa
    const wrong = r2.presign("PUT", k, 60, { contentLength: 999 });
    const bad = await fetch(wrong, { method: "PUT", body: data });
    assert.ok(!bad.ok, `deveria recusar tamanho diferente (HTTP ${bad.status})`);
    assert.equal(await r2.head(k), null);

    const url = r2.presign("PUT", k, 60, { contentLength: data.length });
    const up = await fetch(url, { method: "PUT", body: data });
    assert.ok(up.ok, `PUT ${up.status}`);
    assert.deepEqual(await r2.head(k), { size: 1000 });

    const got = await fetch(r2.presign("GET", k, 60));
    assert.equal(got.status, 200);
    assert.deepEqual(new Uint8Array(await got.arrayBuffer()), data);

    const chunks: Buffer[] = [];
    for await (const c of r2.read(k)) chunks.push(c as Buffer);
    assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), data);

    // sem assinatura: privado
    const anon = await fetch(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${k}`);
    assert.ok([400, 401, 403].includes(anon.status), `sem assinatura deveria ser recusado (HTTP ${anon.status})`);
  } finally {
    await r2.delete(k);
  }
  assert.equal(await r2.head(k), null);
});

test("URL vencida e URL adulterada são recusadas", { skip }, async () => {
  const cfg = r2ConfigFromEnv(env);
  const k = key("b.bin");
  const r2 = new R2Client(cfg);
  await r2.put(k, new Uint8Array([1, 2, 3]));
  try {
    const past = new R2Client(cfg, () => new Date(Date.now() - 3600_000));
    const expired = await fetch(past.presign("GET", k, 60));
    assert.ok(!expired.ok, `URL vencida deveria falhar (HTTP ${expired.status})`);

    const ok = r2.presign("GET", k, 60);
    const tampered = await fetch(ok.replace(k, key("outra.bin")));
    assert.ok(!tampered.ok, "URL para outra chave deveria falhar");
    assert.equal((await fetch(ok)).status, 200);
  } finally {
    await r2.delete(k);
  }
});

test("validade fora do intervalo é recusada antes de assinar", () => {
  const r2 = new R2Client({ accountId: "a".repeat(32), accessKeyId: "k", secretAccessKey: "s", bucket: "b" });
  assert.throws(() => r2.presign("GET", "in/x", 0));
  assert.throws(() => r2.presign("GET", "in/x", 4000));
});

test("a configuração incompleta falha com mensagem que não mostra valores", () => {
  assert.throws(() => r2ConfigFromEnv({ R2_ACCOUNT_ID: "abc" }), (e: Error) => !e.message.includes("abc"));
});

test("URL de download com nome de arquivo: o navegador baixa em vez de tocar", { skip }, async () => {
  const r2 = new R2Client(r2ConfigFromEnv(env));
  const k = key("c.wav");
  await r2.put(k, new Uint8Array([1, 2, 3]));
  try {
    const res = await fetch(r2.presign("GET", k, 60, { downloadName: "mixpro.wav" }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="mixpro.wav"');
    assert.throws(() => r2.presign("GET", k, 60, { downloadName: 'x"; evil' }));
  } finally {
    await r2.delete(k);
  }
});
