import { test } from "node:test";
import assert from "node:assert/strict";
import { jobDoneMessage, notifyToken, validNotifyToken } from "./job-done";

const ID = "11111111-2222-3333-4444-555555555555";

test("assinatura: só vale para o mesmo job e a mesma chave", () => {
  const t = notifyToken("chave", ID);
  assert.ok(validNotifyToken("chave", ID, t));
  assert.ok(!validNotifyToken("outra", ID, t));
  assert.ok(!validNotifyToken("chave", "11111111-2222-3333-4444-555555555556", t));
  assert.ok(!validNotifyToken("chave", ID, "x"));
  assert.ok(!validNotifyToken("chave", ID, undefined));
});

test("mensagens: prévia, entrega, falha; conversão e job curto sem projeto não avisam", () => {
  const base = { tool: "mix_ia", status: "done" as const, preview: false, projectId: ID, wallMs: 90_000 };
  assert.match(jobDoneMessage(base)!.title, /Mix & Master IA ficou pronta/);
  assert.equal(jobDoneMessage(base)!.url, `/premium/${ID}`);
  assert.match(jobDoneMessage({ ...base, preview: true })!.title, /prévia/);
  assert.match(jobDoneMessage({ ...base, status: "failed" })!.body, /Nada foi cobrado/);
  assert.equal(jobDoneMessage({ ...base, tool: "convert", projectId: null }), null);
  assert.equal(jobDoneMessage({ tool: "pitch_tempo", status: "done", preview: false, projectId: null, wallMs: 5000 }), null);
  assert.equal(jobDoneMessage({ tool: "stems", status: "done", preview: false, projectId: null, wallMs: 60_000 })!.url, "/projetos");
});
