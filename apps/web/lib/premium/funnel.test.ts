import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFunnel } from "./funnel";
import { buildReceipt, sendEmail } from "./receipt";

const p = (product: string, o: Partial<{ previewDone: boolean; paid: boolean; delivered: boolean; intro: boolean; refunded: boolean }> = {}) => ({
  product,
  previewDone: false,
  paid: false,
  delivered: false,
  intro: false,
  refunded: false,
  ...o,
});

test("funil: criados → prévia → pago → entregue, taxas e 1ª experiência por produto", () => {
  const rows = buildFunnel([
    p("mix_ia", { previewDone: true, paid: true, delivered: true, intro: true }),
    p("mix_ia", { previewDone: true }),
    p("mix_ia"),
    p("mix_ia", { previewDone: true, paid: true, refunded: true }),
    p("producao", { previewDone: true, paid: true, delivered: true }),
  ]);
  const mix = rows.find((r) => r.product === "mix_ia")!;
  assert.deepEqual({ c: mix.created, pr: mix.previews, pg: mix.paid, d: mix.delivered, i: mix.intro, rf: mix.refunded }, { c: 4, pr: 3, pg: 2, d: 1, i: 1, rf: 1 });
  assert.equal(mix.previewRate, 75);
  assert.equal(mix.payRate, 67);
  assert.equal(rows[0].product, "mix_ia", "ordenado pelo volume");
  assert.deepEqual(buildFunnel([]), []);
});

test("recibo: texto e HTML com o valor, o número e o WhatsApp; só envia com Resend configurado", async () => {
  const r = buildReceipt({ product: "mix_ia", priceBrl: 49.9, listPriceBrl: 249, intro: true, method: "brl", credits: 0, projectUrl: "/premium/abc", orderId: "12345678-aaaa-bbbb-cccc-dddddddddddd" }, "https://app.exemplo.com.br/");
  assert.match(r.subject, /Mix & Master IA/);
  assert.match(r.text, /R\$\s?49,90/);
  assert.match(r.text, /https:\/\/app\.exemplo\.com\.br\/premium\/abc/);
  assert.match(r.text, /21\) 97265-2314/);
  assert.match(r.html, /wa\.me\/5521972652314/);
  assert.ok(!r.html.includes("<script"));
  const calls: string[] = [];
  const f = (async (u: string, i?: RequestInit) => {
    calls.push(`${u} ${(i?.headers as Record<string, string>).Authorization}`);
    return new Response("{}");
  }) as unknown as typeof fetch;
  const mail = { to: "a@b.com", subject: "s", text: "t", html: "h" };
  assert.equal(await sendEmail(mail, f, {}), false, "sem chave não envia");
  assert.equal(calls.length, 0);
  assert.equal(await sendEmail(mail, f, { RESEND_API_KEY: "k", RESEND_FROM: "Mix Pro <oi@x.com>" }), true);
  assert.deepEqual(calls, ["https://api.resend.com/emails Bearer k"]);
  const bad = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
  assert.equal(await sendEmail(mail, bad, { RESEND_API_KEY: "k", RESEND_FROM: "x" }), false);
});
