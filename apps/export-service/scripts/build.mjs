// Empacota o serviço num arquivo só (dist/server.mjs) e o autoteste (dist/selftest.mjs) com o
// esbuild que já vem com o tsx do repositório (sem dependência nova). Usado pelo Dockerfile.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const service = resolve(here, "..");
const repo = resolve(service, "../..");
const fromContracts = createRequire(join(repo, "packages/contracts/package.json"));
const esbuild = createRequire(fromContracts.resolve("tsx/package.json"))("esbuild");

await esbuild.build({
  entryPoints: { server: join(service, "src/server.ts"), selftest: join(service, "scripts/selftest.ts") },
  outdir: join(service, "dist"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: join(service, "tsconfig.json"),
  // dependências CommonJS dentro de um bundle ESM ainda chamam require()
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("dist/server.mjs e dist/selftest.mjs gerados");
