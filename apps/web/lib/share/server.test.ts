import { test } from "node:test";
import assert from "node:assert/strict";
import { createShare, openShare, shareKey, type ShareDeps } from "./server";

function deps(rows: unknown[] = [], err: string | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const signed: string[] = [];
  const d: ShareDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: rows, error: err ? { message: err } : null };
    },
    presign: (m, key, s, o) => {
      signed.push(`${m} ${key} ${s} ${o?.contentLength ?? ""}`);
      return `https://r2/${key}`;
    },
    token: () => "abcdefghijklmnopqrstuvwx",
  };
  return { d, calls, signed };
}

test("cria o link: valida, limpa o título e assina os dois envios com o tamanho", async () => {
  const { d, calls, signed } = deps();
  const r = await createShare(d, "u1", { title: " Meu\u0000 áudio ", preset: "Voz", ext: "m4a", bytes: [1000, 2000], lufs_before: -23.456, lufs_after: Infinity });
  assert.equal(r.ok, true);
  assert.equal(calls[0].fn, "create_share_link");
  assert.equal(calls[0].args.p_title, "Meu  áudio");
  assert.equal(calls[0].args.p_lufs_before, -23.5);
  assert.equal(calls[0].args.p_lufs_after, null);
  assert.deepEqual(signed, ["PUT out/share/abcdefghijklmnopqrstuvwx/a.m4a 600 1000", "PUT out/share/abcdefghijklmnopqrstuvwx/b.m4a 600 2000"]);
});

test("recusa formato, quantidade e tamanho inválidos; limite diário vira 429", async () => {
  for (const input of [{ ext: "mp3", bytes: [1, 1] }, { ext: "wav", bytes: [1] }, { ext: "wav", bytes: [1, 9e9] }, { ext: "wav", bytes: [1, 1.5] }]) {
    const r = await createShare(deps().d, "u1", input);
    assert.equal(r.ok, false);
  }
  const r = await createShare(deps([], "LIMIT").d, "u1", { ext: "wav", bytes: [1, 1] });
  assert.deepEqual(r.ok ? null : r.status, 429);
});

test("abre a página: token inválido nem consulta; expirada é null; válida assina leitura", async () => {
  const a = deps();
  assert.equal(await openShare(a.d, "../../x"), null);
  assert.equal(a.calls.length, 0);
  assert.equal(await openShare(deps([]).d, "abcdefghijklmnopqrstuvwx"), null);
  const b = deps([{ title: "T", preset: "P", ext: "wav", lufs_before: -20, lufs_after: -14, expires_at: "2026-10-10T00:00:00Z", referral_code: "abc" }]);
  const p = await openShare(b.d, "abcdefghijklmnopqrstuvwx");
  assert.equal(p?.before, `https://r2/${shareKey("abcdefghijklmnopqrstuvwx", "a", "wav")}`);
  assert.equal(p?.referralCode, "abc");
  assert.deepEqual(b.signed, ["GET out/share/abcdefghijklmnopqrstuvwx/a.wav 3600 ", "GET out/share/abcdefghijklmnopqrstuvwx/b.wav 3600 "]);
});
