/**
 * Controle único de reverb (Small / Médio / Large + quantidade) para TODOS os presets:
 *  - Bateria de Estúdio: ajusta o reverb do próprio módulo de bateria;
 *  - presets com reverb: ajusta o primeiro reverb da cadeia;
 *  - presets sem reverb: acrescenta um antes do limiter final (só quando a quantidade > 0).
 */
import type { ChainDoc, ChainStep } from "@/lib/dsp/chain";

export type ReverbSize = "small" | "medium" | "large";
export type ReverbTweak = { size: ReverbSize; amount: number };

/** Mesmos tamanhos de sala do reverb da bateria. */
export const SIZES: Record<ReverbSize, { room_size: number; damping: number; predelay_ms: number }> = {
  small: { room_size: 35, damping: 60, predelay_ms: 4 },
  medium: { room_size: 62, damping: 50, predelay_ms: 12 },
  large: { room_size: 86, damping: 38, predelay_ms: 24 },
};

/** Quantidade 100% = 40% de mistura no reverb da cadeia (mais que isso afoga a voz). */
const MIX_AT_100 = 40;

const num = (v: unknown, d: number) =>
  typeof v === "number" ? v : typeof (v as { value?: number })?.value === "number" ? (v as { value: number }).value : d;

const sizeFromRoom = (room: number): ReverbSize => (room < 48 ? "small" : room < 74 ? "medium" : "large");

/** Reverb atual da cadeia (o que o preset traz de fábrica). */
export function reverbFromChain(doc: ChainDoc): ReverbTweak {
  const drum = doc.chain.find((m) => m.type === "drum_studio");
  if (drum) {
    const size = drum.params?.reverb_size;
    return { size: size === "small" || size === "large" ? size : "medium", amount: Math.round(num(drum.params?.reverb, 25)) };
  }
  const rev = doc.chain.find((m) => m.type === "reverb" && !m.bypass);
  if (!rev) return { size: "medium", amount: 0 };
  return {
    size: sizeFromRoom(num(rev.params?.room_size, 50)),
    amount: Math.min(100, Math.round((num(rev.params?.mix, 15) / MIX_AT_100) * 100)),
  };
}

/** Aplica o controle de reverb na cadeia (sem mexer no resto). */
export function withReverb(doc: ChainDoc, t: ReverbTweak | null): ChainDoc {
  if (!t) return doc;
  const amount = Math.min(100, Math.max(0, t.amount));
  const chain = [...doc.chain];

  const di = chain.findIndex((m) => m.type === "drum_studio");
  if (di >= 0) {
    chain[di] = { ...chain[di], params: { ...chain[di].params, reverb_size: t.size, reverb: { value: amount, neutral: 0 } } };
    return { ...doc, chain };
  }

  const params = { ...SIZES[t.size], width: 100, mix: { value: (amount / 100) * MIX_AT_100, neutral: 0 } };
  const ri = chain.findIndex((m) => m.type === "reverb" && !m.bypass);
  if (ri >= 0) {
    chain[ri] = { ...chain[ri], params: { ...chain[ri].params, ...params } };
    return { ...doc, chain };
  }
  if (amount <= 0) return doc;
  // sem reverb no preset: entra antes do limiter final (ou no fim)
  const step: ChainStep = { type: "reverb", params };
  const last = chain.length - 1;
  chain.splice(last >= 0 && chain[last].type === "limiter" ? last : chain.length, 0, step);
  return { ...doc, chain };
}
