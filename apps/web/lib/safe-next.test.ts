import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "./safe-next";

test("Destino após login: só caminhos do próprio site", () => {
  assert.equal(safeNext("/estudio"), "/estudio");
  assert.equal(safeNext("/mixagem-profissional/pedidos/1?pagamento=sucesso#x"), "/mixagem-profissional/pedidos/1?pagamento=sucesso#x");
  for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "javascript:alert(1)", "/\tevil", "", null, undefined]) {
    assert.equal(safeNext(bad), "/", String(bad));
  }
});
