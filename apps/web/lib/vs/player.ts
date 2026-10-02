"use client";

/**
 * Player multipista da prévia do VS (20 s): cada pista com volume, pan, mudo e solo ao vivo.
 * Todas as pistas tocam juntas e em loop; mexer no mixer só muda ganhos e pans (sem recomeçar).
 */
import { audioContext, enableMediaPlayback } from "@/lib/audio/ab-engine";
import { effectiveGains, type TrackData, type TrackMix } from "./export";

type Node = { gain: GainNode; pan: StereoPannerNode; buffer: AudioBuffer; src: AudioBufferSourceNode | null };

export class VSPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes = new Map<string, Node>();
  private startedAt = 0;
  private offset = 0;
  private listeners = new Set<() => void>();
  playing = false;
  duration = 0;

  private c() {
    if (!this.ctx) {
      this.ctx = audioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  /** Trecho de `seconds` a partir de `from` (s) de cada pista. */
  load(tracks: TrackData[], sr: number, from: number, seconds: number, mix: Record<string, TrackMix>) {
    const was = this.playing;
    this.stop();
    for (const n of this.nodes.values()) {
      n.gain.disconnect();
      n.pan.disconnect();
    }
    this.nodes.clear();
    const ctx = this.c();
    const a = Math.max(0, Math.round(from * sr));
    const len = Math.max(1, Math.min(Math.round(seconds * sr), tracks[0].left.length - a));
    for (const t of tracks) {
      const buffer = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
      [t.left, t.right].forEach((src, c) => {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (src[a + i] ?? 0) / 32768;
      });
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.connect(pan).connect(this.master!);
      this.nodes.set(t.id, { gain, pan, buffer, src: null });
    }
    this.duration = len / sr;
    this.offset = 0;
    this.setMix(mix, true);
    if (was) void this.play();
    this.emit();
  }

  setMix(mix: Record<string, TrackMix>, immediate = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const gains = effectiveGains(mix);
    for (const [id, n] of this.nodes) {
      const g = gains[id] ?? 0;
      n.gain.gain.cancelScheduledValues(now);
      n.gain.gain.setValueAtTime(n.gain.gain.value, now);
      n.gain.gain.linearRampToValueAtTime(g, now + (immediate ? 0 : 0.02));
      n.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, mix[id]?.pan ?? 0)), now);
    }
  }

  currentTime(): number {
    if (!this.playing || !this.ctx || !this.duration) return this.offset;
    return Math.max(0, this.offset + this.ctx.currentTime - this.startedAt) % this.duration;
  }

  async play() {
    if (!this.nodes.size || this.playing) return;
    enableMediaPlayback();
    const ctx = this.c();
    if (ctx.state === "suspended") await ctx.resume();
    const when = ctx.currentTime + 0.03;
    const at = Math.min(this.offset, Math.max(0, this.duration - 0.01));
    for (const n of this.nodes.values()) {
      const s = ctx.createBufferSource();
      s.buffer = n.buffer;
      s.loop = true;
      s.connect(n.gain);
      s.start(when, at);
      n.src = s;
    }
    this.startedAt = when;
    this.offset = at;
    this.playing = true;
    this.emit();
  }

  private stop() {
    for (const n of this.nodes.values()) {
      try {
        n.src?.stop();
      } catch {}
      n.src?.disconnect();
      n.src = null;
    }
    this.playing = false;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime();
    this.stop();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    const was = this.playing;
    this.stop();
    this.offset = Math.max(0, Math.min(t, this.duration));
    if (was) void this.play();
    this.emit();
  }

  dispose() {
    this.stop();
    for (const n of this.nodes.values()) {
      n.gain.disconnect();
      n.pan.disconnect();
    }
    this.nodes.clear();
    this.master?.disconnect();
    this.master = null;
    this.ctx = null;
  }
}
