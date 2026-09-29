/** Largura estéreo, delay e reverb. O comprimento é preservado (caudas além do fim são descartadas). */
import { applySections, butterworth } from "./filters";
import type { Signal } from "./types";

export function stereoWidth(audio: Signal, sr: number, p: { width: number; bass_mono_hz: number }): Signal {
  if (audio.length !== 2) return audio;
  if (Math.abs(p.width - 100) < 0.01 && p.bass_mono_hz <= 0) return audio;
  const [l, r] = audio;
  const n = l.length;
  const side = new Float32Array(n);
  const w = p.width / 100;
  for (let i = 0; i < n; i++) side[i] = (l[i] - r[i]) * 0.5 * w;
  if (p.bass_mono_hz > 0) applySections(side, butterworth("hp", 2, Math.min(p.bass_mono_hz, sr * 0.45), sr));
  for (let i = 0; i < n; i++) {
    const mid = (l[i] + r[i]) * 0.5;
    l[i] = mid + side[i];
    r[i] = mid - side[i];
  }
  return audio;
}

export function delay(
  audio: Signal,
  sr: number,
  p: { time_ms: number; feedback: number; lowpass_hz: number; mix: number },
): Signal {
  const m = Math.min(Math.max(p.mix / 100, 0), 1);
  if (m <= 1e-4) return audio;
  const d = Math.max(1, Math.round(p.time_ms * 1e-3 * sr));
  const aLp = Math.exp((-2 * Math.PI * Math.min(p.lowpass_hz, sr * 0.45)) / sr);
  const fb = Math.min(p.feedback, 95) / 100;
  for (const ch of audio) {
    const n = ch.length;
    const line = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const tap = i >= d ? line[i - d] : 0;
      lp = (1 - aLp) * tap + aLp * lp;
      line[i] = ch[i] + fb * lp;
      ch[i] = ch[i] * (1 - m) + lp * m;
    }
  }
  return audio;
}

// ---------------------------------------------------------------------------
// Reverb Freeverb (mesmo algoritmo do juce::Reverb usado pelo pedalboard no worker)
// ---------------------------------------------------------------------------
const COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS = [556, 441, 341, 225];
const SPREAD = 23;

class Comb {
  private buf: Float32Array;
  private idx = 0;
  private last = 0;
  constructor(size: number) {
    this.buf = new Float32Array(Math.max(1, size));
  }
  process(input: number, damp: number, feedback: number): number {
    const out = this.buf[this.idx];
    this.last = out * (1 - damp) + this.last * damp;
    if (Math.abs(this.last) < 1e-20) this.last = 0;
    this.buf[this.idx] = input + this.last * feedback;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return out;
  }
}

class AllPass {
  private buf: Float32Array;
  private idx = 0;
  constructor(size: number) {
    this.buf = new Float32Array(Math.max(1, size));
  }
  process(input: number): number {
    const buffered = this.buf[this.idx];
    this.buf[this.idx] = input + buffered * 0.5;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return buffered - input;
  }
}

export function reverb(
  audio: Signal,
  sr: number,
  p: { room_size: number; damping: number; width: number; predelay_ms: number; mix: number },
): Signal {
  const m = Math.min(Math.max(p.mix / 100, 0), 1);
  if (m <= 1e-4) return audio;
  const n = audio[0].length;
  const pre = Math.round(p.predelay_ms * 1e-3 * sr);
  const scale = (t: number) => Math.floor((Math.floor(sr) * t) / 44100);
  const damp = (p.damping / 100) * 0.4;
  const feedback = (p.room_size / 100) * 0.28 + 0.7;
  const wet = 3;
  const width = p.width / 100;
  const wet1 = 0.5 * wet * (1 + width);
  const wet2 = 0.5 * wet * (1 - width);
  const inGain = 0.015;
  const stereo = audio.length === 2;
  const sides = stereo ? 2 : 1;
  const combs = Array.from({ length: sides }, (_, s) => COMB.map((t) => new Comb(scale(t + s * SPREAD))));
  const aps = Array.from({ length: sides }, (_, s) => ALLPASS.map((t) => new AllPass(scale(t + s * SPREAD))));

  const dry = audio.map((ch) => ch.slice());
  const read = (c: number, i: number) => (i >= pre ? dry[c][i - pre] : 0);

  for (let i = 0; i < n; i++) {
    const input = (stereo ? read(0, i) + read(1, i) : read(0, i)) * inGain;
    let outL = 0;
    let outR = 0;
    for (let j = 0; j < COMB.length; j++) {
      outL += combs[0][j].process(input, damp, feedback);
      if (stereo) outR += combs[1][j].process(input, damp, feedback);
    }
    for (let j = 0; j < ALLPASS.length; j++) {
      outL = aps[0][j].process(outL);
      if (stereo) outR = aps[1][j].process(outR);
    }
    if (stereo) {
      audio[0][i] = dry[0][i] * (1 - m) + (outL * wet1 + outR * wet2) * m;
      audio[1][i] = dry[1][i] * (1 - m) + (outR * wet1 + outL * wet2) * m;
    } else {
      audio[0][i] = dry[0][i] * (1 - m) + outL * wet1 * m;
    }
  }
  return audio;
}
