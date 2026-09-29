/** Executa uma cadeia de preset no áudio (espelha run_chain do worker Python). */
import { MODULES, type ModuleType, type ParamSpec } from "@mixpro/contracts";
import { compressor, gate, limiter } from "./dynamics";
import { eqPeak, eqShelf, highpass, lowpass } from "./filters";
import { integratedLoudness } from "./loudness";
import { reverb, delay, stereoWidth } from "./space";
import { gain, normalize, saturation, softClip } from "./tone";
import type { Signal } from "./types";

type Params = Record<string, number | string>;
type ModuleFn = (audio: Signal, sr: number, p: never) => Signal;

const REGISTRY: Record<ModuleType, ModuleFn> = {
  gain,
  highpass,
  lowpass,
  eq_peak: eqPeak,
  eq_shelf: eqShelf,
  compressor,
  limiter,
  gate,
  saturation,
  soft_clip: softClip,
  stereo_width: stereoWidth,
  delay,
  reverb,
  normalize,
};

export type ChainStep = { type: string; bypass?: boolean; params?: Record<string, unknown> };
export type ChainDoc = { schema_version: number; chain: ChainStep[] };

export function resolveParams(type: ModuleType, raw: Record<string, unknown>, intensity: number): Params {
  const out: Params = {};
  for (const [name, spec] of Object.entries(MODULES[type].params) as [string, ParamSpec][]) {
    const v = raw[name];
    if (spec.kind === "enum") {
      out[name] = typeof v === "string" ? v : spec.default;
      continue;
    }
    let val: number;
    if (v == null) val = spec.default;
    else if (typeof v === "number") val = v;
    else {
      const o = v as { value: number; neutral?: number };
      const neutral = o.neutral ?? spec.neutral ?? o.value;
      val = neutral + (o.value - neutral) * (intensity / 100);
    }
    out[name] = Math.min(Math.max(val, spec.min), spec.max);
  }
  return out;
}

export function runChain(
  audio: Signal,
  sr: number,
  doc: ChainDoc,
  intensity: number,
  onStep?: (done: number, total: number) => void,
): Signal {
  const steps = doc.chain.filter((m) => !m.bypass && m.type in REGISTRY);
  let x = audio;
  steps.forEach((mod, i) => {
    const type = mod.type as ModuleType;
    x = REGISTRY[type](x, sr, resolveParams(type, mod.params ?? {}, intensity) as never);
    onStep?.(i + 1, steps.length);
  });
  for (const ch of x) for (let i = 0; i < ch.length; i++) if (!Number.isFinite(ch[i])) ch[i] = 0;
  return x;
}

/**
 * Ajuste final para redes sociais: leva a loudness ao alvo (padrão -14 LUFS, usado por
 * Instagram, TikTok, YouTube e Spotify) e garante teto de pico com limiter.
 */
export function finalizeForSocial(audio: Signal, sr: number, targetLufs = -14, ceilingDb = -1): Signal {
  const lufs = integratedLoudness(audio, sr);
  const makeup = Number.isFinite(lufs) ? Math.max(-24, Math.min(24, targetLufs - lufs)) : 0;
  return limiter(audio, sr, { ceiling_db: ceilingDb, input_gain_db: makeup, release_ms: 60, lookahead_ms: 5 });
}
