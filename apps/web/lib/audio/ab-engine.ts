"use client";

/**
 * Motor A/B com Web Audio API.
 * Os dois buffers (A = original, B = processado) tocam em sincronia absoluta;
 * alternar A/B só muda os ganhos (rampa de 8 ms) — sem reiniciar e sem clique.
 */
export type ABSide = "A" | "B";

type Listener = () => void;

let sharedCtx: AudioContext | null = null;
function audioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext({ latencyHint: "interactive" });
  return sharedCtx;
}

const bufferCache = new Map<string, Promise<AudioBuffer>>();

/** Baixa e decodifica (com cache por chave estável — a URL assinada muda a cada pedido). */
export function loadBuffer(cacheKey: string, url: string): Promise<AudioBuffer> {
  let p = bufferCache.get(cacheKey);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => audioContext().decodeAudioData(data));
    p.catch(() => bufferCache.delete(cacheKey));
    bufferCache.set(cacheKey, p);
    if (bufferCache.size > 24) bufferCache.delete(bufferCache.keys().next().value!);
  }
  return p;
}

export class ABEngine {
  private graph: { ctx: AudioContext; master: GainNode; gainA: GainNode; gainB: GainNode } | null = null;
  private srcA: AudioBufferSourceNode | null = null;
  private srcB: AudioBufferSourceNode | null = null;
  private bufA: AudioBuffer | null = null;
  private bufB: AudioBuffer | null = null;
  private startedAt = 0;
  private offset = 0;
  private listeners = new Set<Listener>();

  side: ABSide = "B";
  playing = false;
  loop = true;
  /** Ganho linear aplicado ao lado B para comparar no mesmo volume. */
  matchGainB = 1;
  levelMatch = false;
  volume = 0.9;

  /** O grafo de áudio só é criado no navegador, no primeiro uso. */
  private g() {
    if (!this.graph) {
      const ctx = audioContext();
      const master = ctx.createGain();
      const gainA = ctx.createGain();
      const gainB = ctx.createGain();
      gainA.connect(master);
      gainB.connect(master);
      master.connect(ctx.destination);
      master.gain.value = this.volume;
      this.graph = { ctx, master, gainA, gainB };
      this.applyGains(true);
    }
    return this.graph;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  get duration() {
    return Math.max(this.bufA?.duration ?? 0, this.bufB?.duration ?? 0);
  }

  get hasB() {
    return this.bufB !== null;
  }

  currentTime(): number {
    if (!this.playing || !this.graph) return this.offset;
    const t = this.offset + (this.graph.ctx.currentTime - this.startedAt);
    const d = this.duration;
    return d > 0 && this.loop ? t % d : Math.min(t, d);
  }

  setBuffers(a: AudioBuffer | null, b: AudioBuffer | null) {
    const wasPlaying = this.playing;
    const pos = this.currentTime();
    this.stopSources();
    this.bufA = a;
    this.bufB = b;
    if (!b) this.side = "A";
    this.offset = Math.min(pos, this.duration || 0);
    if (wasPlaying && (a || b)) this.start(this.offset);
    else this.playing = false;
    this.applyGains(true);
    this.emit();
  }

  private applyGains(immediate = false) {
    if (!this.graph) return;
    const { ctx, gainA, gainB } = this.graph;
    const now = ctx.currentTime;
    const ramp = immediate ? 0 : 0.008;
    const a = this.side === "A" || !this.bufB ? 1 : 0;
    const b = this.side === "B" && this.bufB ? (this.levelMatch ? this.matchGainB : 1) : 0;
    for (const [node, v] of [
      [gainA, a],
      [gainB, b],
    ] as const) {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(v, now + ramp);
    }
  }

  private stopSources() {
    for (const s of [this.srcA, this.srcB]) {
      if (s) {
        s.onended = null;
        try {
          s.stop();
        } catch {}
        s.disconnect();
      }
    }
    this.srcA = this.srcB = null;
  }

  private start(at: number) {
    const { ctx, gainA, gainB } = this.g();
    const when = ctx.currentTime + 0.03;
    const mk = (buf: AudioBuffer | null, gain: GainNode) => {
      if (!buf) return null;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = this.loop;
      s.connect(gain);
      s.start(when, Math.min(at, Math.max(0, buf.duration - 0.001)));
      return s;
    };
    this.srcA = mk(this.bufA, gainA);
    this.srcB = mk(this.bufB, gainB);
    const ref = this.srcA ?? this.srcB;
    if (ref && !this.loop) {
      ref.onended = () => {
        this.playing = false;
        this.offset = 0;
        this.emit();
      };
    }
    this.startedAt = when;
    this.offset = at;
    this.playing = true;
  }

  async play() {
    if (!this.bufA && !this.bufB) return;
    const { ctx } = this.g();
    if (ctx.state === "suspended") await ctx.resume();
    if (this.playing) return;
    this.start(this.offset >= this.duration ? 0 : this.offset);
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime();
    this.stopSources();
    this.playing = false;
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(seconds: number) {
    const t = Math.max(0, Math.min(seconds, this.duration));
    if (this.playing) {
      this.stopSources();
      this.start(t);
    } else {
      this.offset = t;
    }
    this.emit();
  }

  setSide(side: ABSide) {
    if (side === "B" && !this.bufB) return;
    this.side = side;
    this.applyGains();
    this.emit();
  }

  toggleSide() {
    this.setSide(this.side === "A" ? "B" : "A");
  }

  setLevelMatch(on: boolean, gainB: number) {
    this.levelMatch = on;
    this.matchGainB = gainB;
    this.applyGains();
    this.emit();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.graph) this.graph.master.gain.setTargetAtTime(v, this.graph.ctx.currentTime, 0.01);
    this.emit();
  }

  dispose() {
    this.stopSources();
    this.playing = false;
    this.graph?.master.disconnect();
    this.graph = null;
    this.listeners.clear();
  }
}
