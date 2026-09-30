/**
 * Simulador de amplificador para guitarra e baixo ligados direto (linha/DI):
 * pré-ênfase → estágios de válvula (oversampling 2x) → tone stack (graves/médios/agudos/presença)
 * → saturação do power amp → caixa (resposta do falante + microfone) → volume casado com a entrada.
 */
import { applySections, butterworth, peakingBiquad, shelfBiquad, type Biquad } from "./filters";
import { oversampled } from "./tone";
import { convolve } from "./convolve";
import type { Signal } from "./types";

type Params = {
  model: string;
  gain: number;
  bass: number;
  mid: number;
  treble: number;
  presence: number;
  cabinet: string;
  ir: string;
  blend: number;
  level_db: number;
};

let IRS: Record<string, Float32Array> = {};

/** Caixas gravadas (IR) carregadas pelo app para esta execução, por id. */
export function setImpulses(map: Record<string, Float32Array> | null | undefined) {
  IRS = map ?? {};
}

type Model = {
  /** Passa-altas na entrada (Hz). */
  hp: number;
  /** Realce antes da distorção [freq, dB, Q] (ex.: "pedal" que aperta o grave antes do hi-gain). */
  pre?: [number, number, number];
  /** Aperta o grave antes da distorção (Hz). */
  tight?: number;
  /** Drive em dB com o ganho em 0 e em 10. */
  drive: [number, number];
  stages: 1 | 2;
  /** Assimetria da válvula (harmônicos pares). */
  bias: number;
  /** Filtro entre os estágios (Hz). */
  inter?: [number, number];
  /** Só distorce acima desta frequência; o grave passa limpo (baixo moderno). */
  split?: number;
  stack: { bass: number; mid: number; midQ: number; treble: number; midOffset: number };
  /** Saturação do power amp (dB). */
  power: number;
  cab: string;
};

const MODELS: Record<string, Model> = {
  clean_us: {
    hp: 70,
    drive: [0, 18],
    stages: 1,
    bias: 0.05,
    stack: { bass: 100, mid: 500, midQ: 0.7, treble: 3000, midOffset: -2.5 },
    power: 2,
    cab: "2x12",
  },
  jazz_clean: {
    hp: 60,
    drive: [-6, 9],
    stages: 1,
    bias: 0,
    stack: { bass: 120, mid: 650, midQ: 0.7, treble: 2600, midOffset: 0 },
    power: 0,
    cab: "2x12",
  },
  crunch_uk: {
    hp: 80,
    pre: [1000, 3, 0.8],
    drive: [8, 30],
    stages: 1,
    bias: 0.2,
    stack: { bass: 110, mid: 800, midQ: 0.8, treble: 3200, midOffset: 1 },
    power: 4,
    cab: "2x12",
  },
  rock_classic: {
    hp: 90,
    pre: [800, 4, 0.9],
    drive: [14, 38],
    stages: 2,
    bias: 0.15,
    inter: [100, 7000],
    stack: { bass: 110, mid: 650, midQ: 0.8, treble: 3000, midOffset: 2 },
    power: 5,
    cab: "4x12",
  },
  hi_gain: {
    hp: 90,
    tight: 160,
    pre: [720, 6, 0.7],
    drive: [24, 50],
    stages: 2,
    bias: 0.1,
    inter: [130, 6000],
    stack: { bass: 90, mid: 600, midQ: 0.7, treble: 3500, midOffset: -3 },
    power: 4,
    cab: "4x12",
  },
  bass_vintage: {
    hp: 30,
    drive: [0, 22],
    stages: 1,
    bias: 0.25,
    stack: { bass: 60, mid: 500, midQ: 0.7, treble: 2500, midOffset: 0 },
    power: 4,
    cab: "8x10b",
  },
  bass_modern: {
    hp: 30,
    split: 250,
    pre: [1200, 3, 0.8],
    drive: [10, 36],
    stages: 1,
    bias: 0.1,
    stack: { bass: 80, mid: 500, midQ: 0.8, treble: 3000, midOffset: -2.5 },
    power: 2,
    cab: "4x10b",
  },
  bass_clean: {
    hp: 30,
    drive: [-6, 10],
    stages: 1,
    bias: 0.05,
    stack: { bass: 60, mid: 700, midQ: 0.7, treble: 3500, midOffset: -1 },
    power: 1,
    cab: "4x10b",
  },
};

/** Resposta da caixa + microfone dinâmico na frente do falante. */
function cabinet(id: string, sr: number): Biquad[] {
  const pk = (f: number, g: number, q: number) => peakingBiquad(sr, f, g, q);
  switch (id) {
    case "1x12":
      return [...butterworth("hp", 2, 90, sr), pk(1400, 2, 1), pk(3000, -2, 2), ...butterworth("lp", 4, 5500, sr)];
    case "2x12":
      return [...butterworth("hp", 2, 80, sr), pk(120, 2, 1.2), pk(2400, 3, 1.2), pk(4200, -3, 2), ...butterworth("lp", 4, 5200, sr), ...butterworth("lp", 2, 7500, sr)];
    case "4x12":
      return [
        ...butterworth("hp", 2, 75, sr),
        pk(110, 3.5, 1.3),
        pk(400, -2, 1),
        pk(2200, 3, 1.4),
        pk(3800, -3, 2),
        ...butterworth("lp", 4, 4800, sr),
        ...butterworth("lp", 2, 7000, sr),
      ];
    case "4x10b":
      return [...butterworth("hp", 2, 40, sr), pk(90, 2, 1), pk(2500, 2, 1.2), ...butterworth("lp", 4, 5500, sr)];
    case "8x10b":
      return [...butterworth("hp", 2, 35, sr), pk(70, 3, 1), pk(600, -2, 1), pk(1800, 1.5, 1.2), ...butterworth("lp", 4, 4200, sr)];
    default:
      return [];
  }
}

/** RMS só das partes tocadas (ignora silêncio entre as frases). */
function activeRms(x: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < x.length; i += 4) peak = Math.max(peak, Math.abs(x[i]));
  const gate = peak * 0.02;
  let s = 0;
  let c = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > gate) {
      s += v * v;
      c++;
    }
  }
  return c ? Math.sqrt(s / c) : 0;
}

const tube = (drive: number, bias: number) => {
  const tb = Math.tanh(bias);
  const norm = 1 / Math.max(1e-6, 1 - tb * tb);
  return (v: number) => (Math.tanh(drive * v + bias) - tb) * norm;
};

export function amp(audio: Signal, sr: number, p: Params): Signal {
  const m = MODELS[p.model] ?? MODELS.clean_us;
  const knob = (v: number) => (Math.min(10, Math.max(0, v)) - 5) / 5; // -1..1
  const g = Math.min(10, Math.max(0, p.gain)) / 10;
  const driveDb = m.drive[0] + (m.drive[1] - m.drive[0]) * g;
  const drive = 10 ** (driveDb / 20);
  const blend = Math.min(1, Math.max(0, p.blend / 100));
  // caixa gravada (IR) tem prioridade sobre a caixa simulada por filtros
  const ir = p.ir ? IRS[p.ir] : undefined;
  const cab = ir ? [] : cabinet(p.cabinet === "auto" || !p.cabinet ? m.cab : p.cabinet, sr);
  const stack: Biquad[] = [
    shelfBiquad(sr, m.stack.bass, knob(p.bass) * 12, 0.7, "low"),
    peakingBiquad(sr, m.stack.mid, knob(p.mid) * 10 + m.stack.midOffset, m.stack.midQ),
    shelfBiquad(sr, m.stack.treble, knob(p.treble) * 12, 0.7, "high"),
    shelfBiquad(sr, 5000, knob(p.presence) * 8, 0.7, "high"),
  ];

  // gravação mono em dois canais (comum no celular): processa uma vez só
  if (audio.length === 2 && sameChannels(audio[0], audio[1])) {
    const [one] = processChannels([audio[0]]);
    audio[1].set(one);
    return audio;
  }
  return processChannels(audio);

  function processChannels(chs: Signal): Signal {
    return chs.map((ch) => processOne(ch));
  }

  function processOne(ch: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    const inRms = activeRms(ch);
    if (inRms < 1e-5) return ch;
    const dry = ch.slice();
    // entrada sempre no mesmo nível (celular, interface e pedaleira chegam com volumes diferentes)
    const x = ch.slice();
    const norm = Math.min(30, Math.max(0.05, 0.1 / inRms));
    for (let i = 0; i < x.length; i++) x[i] *= norm;
    applySections(x, butterworth("hp", 2, m.hp, sr));

    let low: Float32Array | null = null;
    if (m.split) {
      low = x.slice();
      applySections(low, butterworth("lp", 2, m.split, sr));
      applySections(x, butterworth("hp", 2, m.split, sr));
    }
    if (m.tight) applySections(x, butterworth("hp", 2, m.tight, sr));
    if (m.pre) applySections(x, [peakingBiquad(sr, m.pre[0], m.pre[1], m.pre[2])]);

    oversampled(x, tube(drive, m.bias));
    applySections(x, butterworth("hp", 1, 10, sr)); // tira o DC da assimetria
    if (m.stages === 2) {
      if (m.inter) applySections(x, [...butterworth("hp", 1, m.inter[0], sr), ...butterworth("lp", 1, m.inter[1], sr)]);
      oversampled(x, tube(3, m.bias * 0.5));
    }
    if (low) for (let i = 0; i < x.length; i++) x[i] += low[i];

    applySections(x, stack);
    if (m.power > 0) {
      const pg = 10 ** (m.power / 20);
      oversampled(x, (v) => Math.tanh(pg * v) / pg);
    }
    let y: Float32Array = x;
    if (ir) y = convolve(x, ir);
    else applySections(x, cab);

    // volume de saída igual ao da entrada (o ganho muda o timbre, não o volume)
    const outRms = activeRms(y);
    const back = outRms > 1e-9 ? inRms / outRms : 1;
    const level = 10 ** (p.level_db / 20);
    for (let i = 0; i < ch.length; i++) ch[i] = (y[i] * back * blend + dry[i] * (1 - blend)) * level;
    return ch;
  }
}

function sameChannels(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i += 97) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  return true;
}
