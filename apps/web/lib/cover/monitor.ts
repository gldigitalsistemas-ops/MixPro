"use client";

/**
 * Retorno no fone durante a gravação do Modo Cover: música (sem o instrumento da pessoa), clique e o instrumento
 * original como guia, cada um com volume, e o REFORÇO: um ganho geral de até +18 dB seguido de um limitador.
 *
 * Bateria acústica é muito alta e o celular (principalmente gravando) toca baixo no fone; aumentar só o volume
 * estouraria. O limitador segura os picos em −1 dBFS e o reforço "empurra" o resto para cima: a música e o clique
 * ficam bem mais altos sem distorcer.
 */
import { audioContext } from "@/lib/audio/ab-engine";
import type { Signal } from "@/lib/dsp/types";

export type MonitorLevels = { music: number; click: number; guide: number; boostDb: number };
export const DEFAULT_LEVELS: MonitorLevels = { music: 80, click: 70, guide: 0, boostDb: 6 };
export const MAX_BOOST_DB = 18;

/** Volume de 0–100 → ganho (curva em dB: 100 = 0 dB, 50 ≈ −12 dB, 0 = mudo). */
export const levelGain = (v: number) => (v <= 0 ? 0 : 10 ** ((-24 * (1 - Math.min(100, v) / 100)) / 20));

type Track = "music" | "click" | "guide";

export class CoverMonitor {
  private ctx: AudioContext;
  private buffers: Partial<Record<Track, AudioBuffer>> = {};
  private gains: Record<Track, GainNode>;
  private boost: GainNode;
  private limiter: DynamicsCompressorNode;
  private sources: AudioScheduledSourceNode[] = [];
  private songStart = 0;
  duration = 0;
  bpm = 120;

  constructor() {
    this.ctx = audioContext();
    this.boost = this.ctx.createGain();
    // limitador: segura os picos (o reforço não distorce); depois um corte em −1 dBFS
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    const ceiling = this.ctx.createGain();
    ceiling.gain.value = 0.89;
    this.boost.connect(this.limiter).connect(ceiling).connect(this.ctx.destination);
    this.gains = { music: this.ctx.createGain(), click: this.ctx.createGain(), guide: this.ctx.createGain() };
    for (const g of Object.values(this.gains)) g.connect(this.boost);
  }

  private toBuffer(x: Signal, sr: number): AudioBuffer {
    const b = new AudioBuffer({ length: x[0].length, numberOfChannels: Math.min(2, x.length), sampleRate: sr });
    for (let c = 0; c < b.numberOfChannels; c++) b.copyToChannel(x[c] as Float32Array<ArrayBuffer>, c);
    return b;
  }

  load(o: { music: Signal; click: Float32Array<ArrayBuffer>; guide: Signal | null; sr: number; bpm: number }) {
    this.buffers = { music: this.toBuffer(o.music, o.sr), click: this.toBuffer([o.click], o.sr), guide: o.guide ? this.toBuffer(o.guide, o.sr) : undefined };
    this.duration = o.music[0].length / o.sr;
    this.bpm = Math.round(o.bpm) || 120;
  }

  setLevels(l: MonitorLevels) {
    const t = this.ctx.currentTime;
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, t, 0.02);
    set(this.gains.music, levelGain(l.music));
    set(this.gains.click, levelGain(l.click));
    set(this.gains.guide, levelGain(l.guide));
    set(this.boost, 10 ** (Math.max(0, Math.min(MAX_BOOST_DB, l.boostDb)) / 20));
  }

  /** Bipe da contagem (no mesmo caminho do clique: respeita o volume do clique e o reforço). */
  private tick(at: number, accent: boolean) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = accent ? 2000 : 1500;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(accent ? 0.7 : 0.5, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    osc.connect(g).connect(this.gains.click);
    osc.start(at);
    osc.stop(at + 0.08);
    this.sources.push(osc);
  }

  /**
   * Toca a partir de `from` (s da música), com `countIn` tempos de contagem antes. Devolve o instante (relógio do
   * áudio) em que a música começa a tocar do ponto `from`.
   */
  async start(from = 0, countIn = 4): Promise<number> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.stop();
    const beat = 60 / this.bpm;
    const t0 = this.ctx.currentTime + 0.15;
    for (let i = 0; i < countIn; i++) this.tick(t0 + i * beat, i === 0);
    const at = t0 + countIn * beat;
    for (const k of ["music", "click", "guide"] as Track[]) {
      const b = this.buffers[k];
      if (!b) continue;
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.gains[k]);
      s.start(at, Math.max(0, Math.min(from, b.duration - 0.01)));
      this.sources.push(s);
    }
    this.songStart = at - from;
    return at;
  }

  /** Posição na música agora (s). */
  position(): number {
    return Math.max(0, this.ctx.currentTime - this.songStart);
  }

  now(): number {
    return this.ctx.currentTime;
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
      s.disconnect();
    }
    this.sources = [];
  }

  dispose() {
    this.stop();
    for (const g of Object.values(this.gains)) g.disconnect();
    this.boost.disconnect();
    this.limiter.disconnect();
  }
}

/** iOS: sessão de áudio para tocar e gravar ao mesmo tempo (o padrão "playback" desliga o microfone). */
export function playAndRecordSession() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = "play-and-record";
  } catch {}
}
