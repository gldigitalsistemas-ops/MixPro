/**
 * Privacidade: o ExportJob (fala transcrita, texto do CTA, nome do preset do usuário) NUNCA vai para
 * reportError, track/track_event, beginTask, console ou qualquer log. Teste estático sobre o código
 * que monta e executa o job.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const EXPORT_DIR = join(WEB, "lib/export");

const FILES = [
  ...readdirSync(EXPORT_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(EXPORT_DIR, f)),
  join(WEB, "components/studio/export-panel.tsx"),
];

/** Chamadas que mandam dados para fora (logs, eventos, registro de queda). */
const SINKS = /\b(reportError|track|trackEvent|beginTask|console\.\w+|navigator\.sendBeacon|fetch)\s*\(/g;

/** O trecho de argumentos de uma chamada (até fechar o parêntese). */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

test("nenhuma chamada de log/evento recebe o ExportJob", () => {
  let calls = 0;
  for (const file of FILES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(SINKS)) {
      calls++;
      // Boolean(...) só manda sim/não (ex.: "tinha legenda"), nunca o conteúdo
      const args = argsAt(src, m.index! + m[0].length - 1).replace(/Boolean\([^()]*\)/g, "true");
      assert.doesNotMatch(args, /\bjob\b|\bexportJob\b|buildExportJob|idempotency_ref|\.captions\b|\.cta\b/, `${file}: ${m[0]}${args.slice(0, 120)})`);
    }
  }
  assert.ok(calls > 3, "o teste deve ter encontrado as chamadas do painel");
});

test("lib/export não registra nada sozinho e os módulos de log não importam o job", () => {
  for (const file of FILES.filter((f) => f.includes("lib")))
    assert.doesNotMatch(readFileSync(file, "utf8"), /\b(reportError|track|beginTask|console\.\w+)\s*\(/, file);
  for (const f of ["lib/error-log.ts", "lib/track.ts"])
    assert.doesNotMatch(readFileSync(join(WEB, f), "utf8"), /lib\/export|ExportJob/, f);
});
