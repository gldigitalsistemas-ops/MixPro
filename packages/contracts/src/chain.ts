import { z } from "zod";
import { MODULES, MODULE_TYPES, type ModuleType, type NumberParam, type ParamSpec } from "./modules";

export const INTENSITIES = [25, 50, 75, 100] as const;
export type Intensity = (typeof INTENSITIES)[number];

/**
 * Parâmetro numérico na cadeia:
 *  - número puro → valor fixo
 *  - { value, neutral? } → `value` em 100% de intensidade, `neutral` em 0%.
 *    Intensidades intermediárias interpolam linearmente.
 */
function numberParamSchema(spec: NumberParam) {
  const n = z.number().min(spec.min).max(spec.max);
  if (!spec.interpolable) return n;
  return z.union([n, z.object({ value: n, neutral: n.optional() }).strict()]);
}

function paramSchema(spec: ParamSpec) {
  if (spec.kind === "enum") {
    const values = spec.options.map((o) => o.value) as [string, ...string[]];
    return z.enum(values);
  }
  return numberParamSchema(spec);
}

function moduleSchema<T extends ModuleType>(type: T) {
  const spec = MODULES[type];
  const shape: Record<string, z.ZodType> = {};
  for (const [name, p] of Object.entries(spec.params) as [string, ParamSpec][]) {
    shape[name] = paramSchema(p).optional();
  }
  return z
    .object({
      type: z.literal(type),
      /** Texto leigo exibido no modo simples, ex.: "Mais presença". */
      label: z.string().max(80).optional(),
      bypass: z.boolean().optional(),
      params: z.object(shape).strict(),
    })
    .strict();
}

const moduleSchemas = MODULE_TYPES.map((t) => moduleSchema(t));

export const chainModuleSchema = z.discriminatedUnion(
  "type",
  moduleSchemas as unknown as [ReturnType<typeof moduleSchema>, ...ReturnType<typeof moduleSchema>[]],
);

export const presetChainSchema = z
  .object({
    schema_version: z.literal(1),
    chain: z.array(chainModuleSchema).max(32),
  })
  .strict();

export type ChainModule = z.infer<typeof chainModuleSchema>;
export type PresetChain = z.infer<typeof presetChainSchema>;

export const EMPTY_CHAIN: PresetChain = { schema_version: 1, chain: [] };

/** Valor efetivo de um parâmetro numérico numa intensidade (espelha o worker). */
export function resolveParam(
  raw: number | { value: number; neutral?: number } | undefined,
  spec: NumberParam,
  intensity: number,
): number {
  if (raw === undefined) return spec.default;
  if (typeof raw === "number") return raw;
  const neutral = raw.neutral ?? spec.neutral ?? raw.value;
  return neutral + (raw.value - neutral) * (intensity / 100);
}
