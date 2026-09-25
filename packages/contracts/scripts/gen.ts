/**
 * Gera os artefatos consumidos pelo worker Python:
 *  - chain.schema.json  → validação da cadeia
 *  - modules.json       → defaults/neutros/limites por parâmetro
 * Grava em packages/contracts/schema e em apps/worker/mixpro_worker/schema.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MODULES, presetChainSchema } from "../src/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [join(root, "schema"), join(root, "..", "..", "apps", "worker", "mixpro_worker", "schema")];

for (const out of targets) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "chain.schema.json"), JSON.stringify(z.toJSONSchema(presetChainSchema), null, 2) + "\n");
  writeFileSync(join(out, "modules.json"), JSON.stringify(MODULES, null, 2) + "\n");
  console.log("contracts: schema gerado em", out);
}
