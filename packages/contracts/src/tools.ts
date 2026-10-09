import { z } from "zod";
import { DELIVERY_IDS } from "./delivery";

/**
 * Ferramentas no servidor: parâmetros validados (o cliente não é confiável) e custo em créditos.
 * O mesmo esquema vale na rota da Vercel e de novo no serviço.
 */
export const TOOL_IDS = ["pitch_tempo", "voice_playback", "reference_master", "album", "stems", "convert"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** Formatos de saída: WAV 16 bits, MP3 e M4A para todos; WAV 24 bits e FLAC no Plano Pro. */
export const TOOL_FORMATS = ["wav", "mp3", "m4a", "wav24", "flac"] as const;
export const PRO_FORMATS: readonly string[] = ["wav24", "flac"];
export type ToolFormat = (typeof TOOL_FORMATS)[number];

/** Duração máxima por arquivo (s). */
export const TOOL_MAX_DURATION_S = 600;

const duration = z.number().finite().positive().max(TOOL_MAX_DURATION_S);
const format = z.enum(TOOL_FORMATS);

export const toolParamsSchemas = {
  pitch_tempo: z
    .object({ semitones: z.number().int().min(-12).max(12), tempo: z.number().min(0.5).max(1.5), format, durations: z.array(duration).length(1) })
    .strict()
    .refine((p) => p.semitones !== 0 || Math.abs(p.tempo - 1) > 1e-3, "INVALID_JOB"),
  voice_playback: z
    .object({
      /** null = alinhar automaticamente. */
      offset_s: z.number().min(-10).max(10).nullable(),
      voice_level_db: z.number().min(-6).max(6),
      reverb: z.number().min(0).max(100),
      delivery: z.enum(DELIVERY_IDS),
      format,
      durations: z.array(duration).length(2),
    })
    .strict(),
  reference_master: z.object({ amount: z.number().min(0).max(1), format, durations: z.array(duration).length(2) }).strict(),
  album: z.object({ amount: z.number().min(0).max(1), delivery: z.enum(DELIVERY_IDS), format, durations: z.array(duration).min(2).max(12) }).strict(),
  stems: z.object({ format, durations: z.array(duration).length(1) }).strict(),
  convert: z.object({ format: z.enum(["flac", "wav"]), durations: z.array(duration).length(1) }).strict(),
} as const;

export type ToolParams<T extends ToolId> = z.infer<(typeof toolParamsSchemas)[T]>;

/** Quantos arquivos cada ferramenta recebe. */
export function toolInputCount(tool: ToolId, params: { durations: number[] }): number {
  return params.durations.length;
}

export type ToolCosts = { pitch_tempo: number; voice_playback: number; reference_master: number; album_track: number; stems: number; stems_extra_6min: number; convert: number; report: number };
export const DEFAULT_TOOL_COSTS: ToolCosts = { pitch_tempo: 2, voice_playback: 3, reference_master: 3, album_track: 2, stems: 4, stems_extra_6min: 1, convert: 0, report: 1 };

/** Lê o ajuste do admin com segurança (valores fora do esperado voltam ao padrão). */
export function parseToolCosts(v: unknown): ToolCosts {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_TOOL_COSTS };
  for (const k of Object.keys(out) as (keyof ToolCosts)[]) {
    const n = Number(o[k]);
    if (Number.isInteger(n) && n >= 0 && n <= 20) out[k] = n;
  }
  return out;
}

/** Créditos de um pedido (a separação de faixas cobra a cada 6 minutos além dos primeiros 6). */
export function toolCredits(tool: ToolId, params: { durations: number[] }, costs: ToolCosts = DEFAULT_TOOL_COSTS): number {
  switch (tool) {
    case "pitch_tempo":
      return costs.pitch_tempo;
    case "voice_playback":
      return costs.voice_playback;
    case "reference_master":
      return costs.reference_master;
    case "album":
      return costs.album_track * params.durations.length;
    case "stems":
      return costs.stems + Math.max(0, Math.ceil(params.durations[0] / 360) - 1) * costs.stems_extra_6min;
    case "convert":
      return costs.convert;
  }
}

/** Valida os parâmetros de uma ferramenta; devolve null se inválidos (o motivo nunca vai para o cliente). */
export function parseToolParams(tool: string, raw: unknown): { tool: ToolId; params: { durations: number[]; format: string } & Record<string, unknown> } | null {
  if (!(TOOL_IDS as readonly string[]).includes(tool)) return null;
  const r = toolParamsSchemas[tool as ToolId].safeParse(raw);
  return r.success ? { tool: tool as ToolId, params: r.data as { durations: number[]; format: string } & Record<string, unknown> } : null;
}
