/**
 * Privacidade: o ExportJob (fala transcrita, texto e @ do CTA, nome do preset do usuário) NUNCA vai
 * para reportError, track/track_event, beginTask, console ou qualquer log. Teste estático sobre o
 * código que monta e executa o job: app, lib/export (inclusive a validação do servidor), os
 * scripts do servidor (scripts/*-export-job.ts) e o serviço de exportação (apps/export-service).
 * No serviço vale também: nada de conteúdo do job, CTA, nome de arquivo, slug, ref, chave de
 * armazenamento ou URL em logs, e só src/log.ts escreve no stdout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const EXPORT_DIR = join(WEB, "lib/export");
const SERVICE = join(WEB, "../export-service");

/** Todos os .ts (exceto testes) de uma pasta, recursivo. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return f.endsWith(".ts") && !f.endsWith(".test.ts") ? [p] : [];
  });
}
const SERVICE_SRC = tsFiles(join(SERVICE, "src"));
const SERVICE_FILES = [...SERVICE_SRC, ...tsFiles(join(SERVICE, "scripts"))];

const FILES = [
  ...readdirSync(EXPORT_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(EXPORT_DIR, f)),
  join(WEB, "components/studio/export-panel.tsx"),
  ...readdirSync(join(WEB, "scripts"))
    .filter((f) => /export-job\.ts$|ffmpeg-encode\.ts$/.test(f))
    .map((f) => join(WEB, "scripts", f)),
  ...SERVICE_FILES,
];

/** Chamadas que mandam dados para fora (logs, eventos, registro de queda). */
const SINKS = /\b(reportError|track|trackEvent|beginTask|console\.\w+|navigator\.sendBeacon|fetch|logJob|logService|process\.std(?:out|err)\.write)\s*\(/g;

/** O que nunca pode aparecer nos argumentos de um log/evento (app e lib/export). */
const FORBIDDEN_APP = /\bjob\b|\bexportJob\b|buildExportJob|idempotency_ref|\.captions\b|\.cta\b|\bcta\b|\.handle\b/;

/** No serviço a regra é mais rígida: também slug, refs, chaves de armazenamento, nomes e URLs. */
const FORBIDDEN =
  /\bjob\b|\bexportJob\b|buildExportJob|idempotency_ref|\.captions\b|\.cta\b|\bcta\b|\.handle\b|job_json|input_key|output_key|\bslug\b|audio_ref|file_ref|\burl\b|\.file\b|\.files\b|\bfilename\b|\bstorageUrl\b|assetStorageUrl/;

const FORBIDDEN_IN_FETCH = new RegExp(FORBIDDEN.source.split("|").filter((t) => !/url|storageUrl/i.test(t)).join("|"));

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
      // textos fixos entre aspas não carregam dados (ex.: a mensagem de uso "--job job.json");
      // template literals continuam verificados, porque é neles que um valor poderia entrar
      const args = argsAt(src, m.index! + m[0].length - 1)
        .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
        .replace(/Boolean\([^()]*\)/g, "true");
      // fetch é rede (download de sample, catálogo): a URL é o próprio pedido; o conteúdo do job continua proibido
      const service = file.startsWith(SERVICE);
      const forbidden = !service ? FORBIDDEN_APP : m[1] === "fetch" ? FORBIDDEN_IN_FETCH : FORBIDDEN;
      assert.doesNotMatch(args, forbidden, `${file}: ${m[0]}${args.slice(0, 120)})`);
    }
  }
  assert.ok(calls > 3, "o teste deve ter encontrado as chamadas do painel");
});

test("os scripts do servidor estão na verificação (e o CTA também)", () => {
  assert.ok(FILES.some((f) => f.endsWith("run-export-job.ts")), "run-export-job.ts verificado");
  assert.ok(FILES.some((f) => f.endsWith("server-validate.ts")), "server-validate.ts verificado");
});

test("serviço: verificado, e só src/log.ts escreve no stdout/console", () => {
  assert.ok(SERVICE_SRC.some((f) => f.endsWith("pipeline.ts")), "pipeline.ts verificado");
  assert.ok(SERVICE_SRC.some((f) => f.endsWith("server.ts")), "server.ts verificado");
  for (const file of SERVICE_SRC.filter((f) => !f.endsWith("log.ts")))
    assert.doesNotMatch(readFileSync(file, "utf8"), /\b(console\.\w+|process\.std(?:out|err)\.write)\s*\(/, file);
});

test("lib/export não registra nada sozinho e os módulos de log não importam o job", () => {
  for (const file of FILES.filter((f) => f.startsWith(EXPORT_DIR)))
    assert.doesNotMatch(readFileSync(file, "utf8"), /\b(reportError|track|beginTask|console\.\w+)\s*\(/, file);
  for (const f of ["lib/error-log.ts", "lib/track.ts"])
    assert.doesNotMatch(readFileSync(join(WEB, f), "utf8"), /lib\/export|ExportJob/, f);
});
