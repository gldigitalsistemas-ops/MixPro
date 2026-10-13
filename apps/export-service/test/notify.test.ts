import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { makeNotifier } from "../src/notify";

const ID = "11111111-2222-3333-4444-555555555555";

test("avisa o site com a assinatura certa; lê o endereço do banco; erro e demora não derrubam", async () => {
  const calls: { url: string; body?: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as string | undefined });
    if (url.includes("system_settings")) return new Response(JSON.stringify([{ value: "https://app.exemplo.com.br/" }]));
    return new Response("{}");
  }) as unknown as typeof fetch;
  const n = makeNotifier({ supabaseUrl: "https://x.supabase.co", anonKey: "anon", serviceKey: "svc", fetchFn: f });
  await n(ID);
  await n(ID);
  const post = calls.filter((c) => c.url.endsWith("/api/internal/job-done"));
  assert.equal(post.length, 2);
  assert.equal(calls.filter((c) => c.url.includes("system_settings")).length, 1, "endereço lido uma vez");
  const body = JSON.parse(post[0].body!);
  assert.equal(body.token, createHmac("sha256", "svc").update(`notify:${ID}`).digest("hex"));
  assert.ok(post[0].url.startsWith("https://app.exemplo.com.br/api"), post[0].url);

  const boom = makeNotifier({ supabaseUrl: "https://x", anonKey: "a", serviceKey: "s", appUrl: "https://a.com", fetchFn: (async () => Promise.reject(new Error("rede"))) as unknown as typeof fetch });
  await boom(ID);
  const slow = makeNotifier({ supabaseUrl: "https://x", anonKey: "a", serviceKey: "s", appUrl: "https://a.com", timeoutMs: 50, fetchFn: ((_u: string, i?: RequestInit) => new Promise((_r, rej) => i?.signal?.addEventListener("abort", () => rej(new Error("abort"))))) as unknown as typeof fetch });
  const t0 = Date.now();
  await slow(ID);
  assert.ok(Date.now() - t0 < 500);
  const bad = makeNotifier({ supabaseUrl: "https://x", anonKey: "a", serviceKey: "s", fetchFn: (async () => new Response(JSON.stringify([{ value: "http://malicioso" }]))) as unknown as typeof fetch });
  await bad(ID);
});
