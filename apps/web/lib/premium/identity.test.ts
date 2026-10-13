import { test } from "node:test";
import assert from "node:assert/strict";
import { disposableEmail, idFromToken, introIdentity, netPrefix, validCpf } from "./identity";

test("CPF: dígitos verificadores, máscara e sequências repetidas", () => {
  assert.equal(validCpf("529.982.247-25"), "52998224725");
  assert.equal(validCpf("52998224724"), null);
  assert.equal(validCpf("111.111.111-11"), null);
  assert.equal(validCpf("123"), null);
});

test("rede: /24 no IPv4 e /48 no IPv6; e-mail descartável", () => {
  assert.equal(netPrefix("200.150.10.77"), "200.150.10");
  assert.equal(netPrefix("::ffff:10.0.0.9"), "10.0.0");
  assert.equal(netPrefix("2804:14c:5b80:8a5c:1:2:3:4"), "2804:14c:5b80");
  assert.equal(netPrefix(null), null);
  assert.equal(disposableEmail("x@mailinator.com"), true);
  assert.equal(disposableEmail("x@gmail.com"), false);
});

test("identidade: só hashes; motivo claro quando falta algo; mesmo CPF com máscara diferente = mesmo hash", () => {
  const base = { deviceId: "a".repeat(32), cpf: "529.982.247-25", fingerprint: "b".repeat(32), ip: "200.1.2.3", email: "a@gmail.com", emailConfirmed: true };
  const a = introIdentity("segredo", base);
  const b = introIdentity("segredo", { ...base, cpf: "52998224725" });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.match(a.id.cpfHash, /^[a-f0-9]{64}$/);
  assert.equal(a.id.cpfHash, b.id.cpfHash);
  assert.ok(!JSON.stringify(a.id).includes("52998224725"), "nada em claro");
  assert.notEqual(introIdentity("outro", base).ok && (introIdentity("outro", base) as { id: { cpfHash: string } }).id.cpfHash, a.id.cpfHash);
  assert.deepEqual(introIdentity("s", { ...base, emailConfirmed: false }), { ok: false, reason: "EMAIL_UNCONFIRMED" });
  assert.deepEqual(introIdentity("s", { ...base, email: "z@yopmail.com" }), { ok: false, reason: "EMAIL_DISPOSABLE" });
  assert.deepEqual(introIdentity("s", { ...base, cpf: "000" }), { ok: false, reason: "CPF_INVALID" });
  assert.deepEqual(introIdentity("s", { ...base, deviceId: "x" }), { ok: false, reason: "DEVICE_MISSING" });
  const noFp = introIdentity("s", { ...base, fingerprint: null });
  assert.ok(noFp.ok && noFp.id.netHash === null, "sem assinatura do navegador não bloqueia pela rede");
});

test("vitrine do Estúdio: o mesmo link sempre gera o mesmo UUID válido; links diferentes, UUIDs diferentes", () => {
  const a = idFromToken("abcdefghijklmnopqrstuvwx");
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(a, idFromToken("abcdefghijklmnopqrstuvwx"));
  assert.notEqual(a, idFromToken("abcdefghijklmnopqrstuvwy"));
});
