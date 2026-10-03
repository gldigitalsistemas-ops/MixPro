import { test } from "node:test";
import assert from "node:assert/strict";
import { P_REF, SERVER_LIMITS } from "../src/index";

test("p_ref do servidor usa o mesmo formato do spend_export_credit", () => {
  // migração 20260929000001_free_app.sql: p_ref !~ '^[a-zA-Z0-9:_-]{8,128}$'
  assert.equal(P_REF.source, "^[a-zA-Z0-9:_-]{8,128}$");
  assert.ok(P_REF.test("57e8e170_vocal-pop-limpo_75_1_n0_x43cd0b20_e6da8012a_wav"));
  assert.ok(!P_REF.test("a b c d e f"));
});

test("limites coerentes entre si: o máximo de trechos de corte cabe no tamanho máximo do JSON", () => {
  const segment = JSON.stringify({ start: 123.45678901234567, end: 123.98765432109876 }) + ",";
  assert.ok(SERVER_LIMITS.maxSegments * segment.length < SERVER_LIMITS.maxJobBytes - 8 * 1024, "sobra ≥ 8 KB para o resto do job");
  assert.ok(SERVER_LIMITS.maxDurationS <= 15 * 60, "nunca acima do limite do próprio app (15 min)");
});
