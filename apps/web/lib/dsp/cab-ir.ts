/**
 * Caixas do Mix Pro: IRs de caixa + microfone geradas no próprio app (nada para baixar e sem
 * licença de terceiros). Cada caixa é modelada a partir do que se mede numa caixa real:
 * ressonância do falante no grave, corte do cone no agudo, picos e vales do "breakup" do cone,
 * reflexões internas (caixa fechada) ou a onda de trás (caixa aberta) e o caráter do microfone.
 */
import { applySections, butterworth, peakingBiquad, shelfBiquad, type Biquad } from "./filters";

type Mic = "dinamico" | "fita" | "condensador";

export type CabDef = {
  id: string;
  kind: "guitar" | "bass";
  name: string;
  description: string;
  /** Corte de grave da caixa (Hz). */
  hp: number;
  /** Ressonância do falante [Hz, dB, Q]. */
  res: [number, number, number];
  /** Realces e cortes do falante [Hz, dB, Q]. */
  peaks: [number, number, number][];
  /** Onde o falante deixa de reproduzir agudo (Hz). */
  lp: number;
  /** Caixa aberta atrás (menos grave, mais ar) ou fechada (grave firme). */
  open: boolean;
  /** Breakup do cone: faixa (Hz) e profundidade (dB) dos picos e vales irregulares. */
  breakup: [number, number, number];
  mic: Mic;
};

export const CABS: CabDef[] = [
  {
    id: "mp:g-4x12-v30",
    kind: "guitar",
    name: "4x12 V30 · dinâmico no centro",
    description: "Moderna e agressiva, médios-agudos na cara. Rock pesado e metal.",
    hp: 70,
    res: [105, 6.5, 1.3],
    peaks: [[400, -2.5, 1], [1500, -1.5, 2], [2600, 5, 1.3], [4100, 3, 2.5]],
    lp: 5600,
    open: false,
    breakup: [1800, 6000, 3],
    mic: "dinamico",
  },
  {
    id: "mp:g-4x12-greenback",
    kind: "guitar",
    name: "4x12 Greenback · dinâmico na borda",
    description: "Clássica britânica: médios quentes e agudo macio. Blues e rock dos anos 70.",
    hp: 75,
    res: [100, 3, 1.3],
    peaks: [[1200, 3, 1], [2200, 2, 1.5], [3500, -2, 2]],
    lp: 4300,
    open: false,
    breakup: [1500, 5000, 2.5],
    mic: "dinamico",
  },
  {
    id: "mp:g-2x12-alnico",
    kind: "guitar",
    name: "2x12 Alnico · microfone de fita",
    description: "Aberta e cristalina com o calor do microfone de fita. Worship, indie e pop.",
    hp: 80,
    res: [115, 2, 1.2],
    peaks: [[700, -1.5, 1], [2800, 3, 1.4], [5000, 1.5, 2]],
    lp: 6200,
    open: true,
    breakup: [2000, 7000, 2],
    mic: "fita",
  },
  {
    id: "mp:g-1x12-aberta",
    kind: "guitar",
    name: "1x12 combo aberto · condensador",
    description: "Limpa e com brilho, grave leve. Funk, jazz e guitarras limpas de pop.",
    hp: 95,
    res: [130, 1.5, 1],
    peaks: [[450, -2, 1], [3200, 2.5, 1.2]],
    lp: 6800,
    open: true,
    breakup: [2500, 8000, 2],
    mic: "condensador",
  },
  {
    id: "mp:g-1x12-vintage",
    kind: "guitar",
    name: "1x12 americano vintage · dinâmico",
    description: "Brilho estalado e médios cavados. Country, sertanejo e blues limpo.",
    hp: 90,
    res: [120, 2.5, 1.2],
    peaks: [[500, -3, 0.9], [1800, 1, 1], [3800, 4, 1.5]],
    lp: 6000,
    open: true,
    breakup: [2000, 6500, 2.5],
    mic: "dinamico",
  },
  {
    id: "mp:b-8x10",
    kind: "bass",
    name: "8x10 clássico · dinâmico",
    description: "O grave valvulado de palco: gordo, com médios rosnando. Rock.",
    hp: 38,
    res: [70, 4, 1.1],
    peaks: [[300, -1.5, 1], [550, 1.5, 1], [1600, 2, 1.2]],
    lp: 4200,
    open: false,
    breakup: [1000, 4000, 2.5],
    mic: "dinamico",
  },
  {
    id: "mp:b-4x10-tweeter",
    kind: "bass",
    name: "4x10 com tweeter · condensador",
    description: "Moderna e definida, com o estalo das cordas. Slap, gospel e pop.",
    hp: 42,
    res: [85, 3, 1.1],
    peaks: [[400, -3, 1], [2500, 2, 1.2], [6000, 3, 1.2]],
    lp: 9000,
    open: false,
    breakup: [1500, 6000, 1.5],
    mic: "condensador",
  },
  {
    id: "mp:b-1x15",
    kind: "bass",
    name: "1x15 vintage · dinâmico",
    description: "Redonda e profunda, sem agudo sobrando. Soul, MPB e reggae.",
    hp: 35,
    res: [60, 5, 1.2],
    peaks: [[250, 1.5, 1], [900, -2, 1]],
    lp: 2800,
    open: false,
    breakup: [800, 2800, 2],
    mic: "dinamico",
  },
  {
    id: "mp:b-2x10",
    kind: "bass",
    name: "2x10 compacta · dinâmico",
    description: "Apertada e com punch: corta a mix em rock e pop.",
    hp: 55,
    res: [95, 3.5, 1.3],
    peaks: [[350, -2, 1], [1200, 2.5, 1], [3000, 1.5, 1.5]],
    lp: 5000,
    open: false,
    breakup: [1200, 5000, 2],
    mic: "dinamico",
  },
  {
    id: "mp:b-2x12",
    kind: "bass",
    name: "2x12 de baixo · microfone de fita",
    description: "Médios quentes e cheios, grave controlado. Rock clássico e blues.",
    hp: 45,
    res: [80, 3, 1.2],
    peaks: [[800, 2.5, 0.9], [2000, 1, 1.2]],
    lp: 4500,
    open: false,
    breakup: [1000, 4500, 2],
    mic: "fita",
  },
];

export const isBuiltinCab = (id: string) => id.startsWith("mp:");

/** Gerador pseudoaleatório com semente (o breakup de cada caixa é sempre o mesmo). */
function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function micSections(mic: Mic, sr: number): Biquad[] {
  switch (mic) {
    case "dinamico":
      return [peakingBiquad(sr, 5000, 2, 1), ...butterworth("lp", 2, Math.min(12000, sr * 0.45), sr)];
    case "fita":
      return [shelfBiquad(sr, 5000, -4, 0.7, "high"), peakingBiquad(sr, 200, 1.5, 0.8)];
    case "condensador":
      return [shelfBiquad(sr, 8000, 1.5, 0.7, "high")];
  }
}

/** IR mono na taxa pedida (50 ms), com a energia normalizada. */
export function synthCabIR(def: CabDef, sr: number): Float32Array {
  const n = Math.round(sr * 0.05);
  const x = new Float32Array(n);
  const at = (ms: number) => Math.min(n - 1, Math.round((ms / 1000) * sr));
  x[0] = 1;
  if (def.open) {
    // onda de trás do cone (fase invertida): cancela parte do grave, como num combo aberto
    x[at(1.6)] -= 0.32;
    x[at(3.4)] += 0.08;
  } else {
    // reflexões dentro da caixa fechada
    x[at(0.9)] -= 0.18;
    x[at(2.1)] += 0.09;
    x[at(3.7)] -= 0.04;
  }

  const nyq = sr * 0.45;
  const sections: Biquad[] = [
    ...butterworth("hp", 2, def.hp, sr),
    peakingBiquad(sr, def.res[0], def.res[1], def.res[2]),
    ...def.peaks.filter(([f]) => f < nyq).map(([f, g, q]) => peakingBiquad(sr, f, g, q)),
    ...butterworth("lp", 4, Math.min(def.lp, nyq), sr),
    ...butterworth("lp", 2, Math.min(def.lp * 1.6, nyq), sr),
    ...micSections(def.mic, sr),
  ];
  // breakup: picos e vales estreitos e irregulares no médio-agudo (o que dá "cara" de caixa gravada)
  const rnd = seeded(def.id);
  const [lo, hi, depth] = def.breakup;
  for (let i = 0; i < 9; i++) {
    const f = lo * (hi / lo) ** ((i + rnd()) / 9);
    if (f >= nyq) break;
    const g = (rnd() * 2 - 1) * depth;
    sections.push(peakingBiquad(sr, f, g, 4 + rnd() * 6));
  }
  applySections(x, sections);

  // final suave para não cortar a cauda de repente
  const fade = Math.round(n * 0.3);
  for (let i = 0; i < fade; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i] * x[i];
  const g = e > 0 ? 1 / Math.sqrt(e) : 1;
  for (let i = 0; i < n; i++) x[i] *= g;
  return x;
}
