/** Música de fundo com "ducking": abaixa sozinha enquanto a voz fala e volta nas pausas. */
import { limiter } from "@/lib/dsp/dynamics";
import { resample } from "@/lib/dsp/resample";
import type { Signal } from "@/lib/dsp/types";

export type MusicLevel = "baixa" | "media" | "alta";

/** Volume da música em relação ao volume da voz (dB). */
const LEVEL_DB: Record<MusicLevel, number> = { baixa: -24, media: -18, alta: -13 };
/** Quanto a música desce enquanto há fala (dB). */
const DUCK_DB = 9;

export type Music = { name: string; channels: Signal; sampleRate: number };

/** Converte a música para a taxa e o número de canais da voz (uma vez, ao escolher o arquivo). */
export function prepareMusic(src: Music, sampleRate: number, channels: number): Signal {
  const base = src.channels.map((ch) => resample(ch, src.sampleRate, sampleRate));
  return Array.from({ length: channels }, (_, c) => base[Math.min(c, base.length - 1)]);
}

function rms(sig: Signal, from: number, to: number): number {
  let s = 0;
  let n = 0;
  for (const ch of sig) for (let i = from; i < to; i += 4) {
    s += ch[i] * ch[i];
    n++;
  }
  return n ? Math.sqrt(s / n) : 0;
}

/**
 * Mistura a música (em loop se for curta) sob a voz. Na prévia `voice` é um trecho do meio:
 * `offset` = posição do trecho no arquivo e `total` = tamanho do arquivo (para os fades).
 */
export function mixMusic(voice: Signal, music: Signal, sr: number, level: MusicLevel, offset = 0, total?: number): Signal {
  const n = voice[0].length;
  const end = total ?? n;
  const mlen = music[0].length;
  if (!n || !mlen) return voice;

  // nível de referência: volume típico da voz nos trechos com fala
  const hop = Math.round(sr * 0.05);
  const frames = Math.ceil(n / hop);
  const vr = new Float32Array(frames);
  for (let f = 0; f < frames; f++) vr[f] = rms(voice, f * hop, Math.min(n, (f + 1) * hop));
  const sorted = Float32Array.from(vr).sort();
  const speech = sorted[Math.floor(frames * 0.9)] || 0.05;
  const mr = rms(music, 0, Math.min(mlen, sr * 30)) || 0.05;
  const base = (speech / mr) * 10 ** (LEVEL_DB[level] / 20);

  // envelope de ducking: desce rápido quando a voz entra (60 ms) e volta devagar (500 ms)
  const talking = Math.max(speech * 0.25, 1e-4);
  const duck = 10 ** (-DUCK_DB / 20);
  const aDown = Math.exp(-1 / (0.06 * 20));
  const aUp = Math.exp(-1 / (0.5 * 20));
  const gainAt = new Float32Array(frames + 1);
  let g = 1;
  for (let f = 0; f < frames; f++) {
    const target = vr[f] > talking ? duck : 1;
    g = target < g ? aDown * g + (1 - aDown) * target : aUp * g + (1 - aUp) * target;
    gainAt[f] = g;
  }
  gainAt[frames] = g;

  const fade = Math.round(sr * 1.5);
  return voice.map((ch, c) => {
    const out = new Float32Array(n);
    const m = music[Math.min(c, music.length - 1)];
    for (let i = 0; i < n; i++) {
      const f = i / hop;
      const f0 = Math.floor(f);
      const gd = gainAt[f0] + (gainAt[Math.min(frames, f0 + 1)] - gainAt[f0]) * (f - f0);
      const edge = Math.min(1, (i + offset) / fade, (end - (i + offset)) / fade);
      out[i] = ch[i] + m[(i + offset) % mlen] * base * gd * Math.max(0, edge);
    }
    return out;
  });
}

/** Garante que a mistura não passe do teto de -1 dBFS. */
export function safeCeiling(sig: Signal, sr: number): Signal {
  return limiter(sig, sr, { ceiling_db: -1, input_gain_db: 0, release_ms: 80, lookahead_ms: 5 });
}
