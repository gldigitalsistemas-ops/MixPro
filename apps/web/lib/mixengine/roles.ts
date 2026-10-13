/**
 * Conhecimento de mixagem por papel de pista e por estilo: o que um engenheiro faria por padrão.
 * Volumes são relativos à voz principal (LU); o motor ajusta pelo conteúdo real de cada pista.
 */
import type { MixGenre, TrackRole } from "@mixpro/contracts";

/** Reconhece o papel da pista pelo nome do arquivo (português e inglês). O usuário confere na tela. */
export function guessRole(fileName: string): TrackRole {
  const n = fileName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[_\-.()]+/g, " ");
  const has = (re: RegExp) => re.test(` ${n} `);
  if (has(/(back|\bbv\b|bvox|coro|backing|harmon|dobra|double|vocal ?2|voz ?2|vozes|choir)/)) return "backing_vocal";
  if (has(/(lead ?voc|voz ?principal|vocal ?principal|\bvox\b|\bvoz\b|\bvocal|\blv\b|\bvoice\b|cantor|cantora)/)) return "lead_vocal";
  if (has(/(drum ?loop|\bloop|\bbeat\b|groove)/)) return "loop";
  if (has(/(kick|bumbo|bombo|\bbd\b|\bkik\b)/)) return "kick";
  if (has(/(snare|caixa|\bsn\b|\bsd\b|\bcx\b)/)) return "snare";
  if (has(/(hi ?hat|\bhh\b|chimbal|contratempo|\bhat\b)/)) return "hihat";
  if (has(/(\btom\b|\btoms\b|\btom \d|surdo|floor)/)) return "toms";
  if (has(/(overhead|\boh\b|\bover\b|prato|cymbal|crash|\bride\b)/)) return "overheads";
  if (has(/(\broom\b|ambiente|\bamb\b|\bsala\b)/)) return "room";
  if (has(/(perc|shaker|pandeiro|conga|bongo|tamborim|cajon|repique|timbal|agog|\bclap|tambourine|ganza|ganza)/)) return "percussion";
  if (has(/(drum|bateria|batera|\bkit\b)/)) return "drums";
  if (has(/(bass|baixo|\bsub\b|808|contrabaixo)/)) return "bass";
  if (has(/(acous|violao|\bviola\b|\bvl\b|\bag\b|nylon|cavaco|banjo|ukulele)/)) return "acoustic_guitar";
  if (has(/(guitar|\bgtr|guitarra|\bgt\b|\beg\b|riff|\bsolo\b)/)) return "electric_guitar";
  if (has(/(piano|\bpno\b|rhodes|wurli|\bep\b)/)) return "piano";
  if (has(/(\bpad|atmos|ambience|textura)/)) return "pad";
  if (has(/(synth|sint|\barp|pluck)/)) return "synth";
  if (has(/(keys|teclado|\bkey\b|organ|orgao|hammond|sanfona|acordeon|accordion)/)) return "keys";
  if (has(/(string|cordas|violin|violino|cello|\borq)/)) return "strings";
  if (has(/(brass|metais|\bsax|trumpet|trompete|trombone|horn)/)) return "brass";
  if (has(/(\bfx\b|efeito|riser|sweep|impact|uplifter|downlifter|\bnoise\b)/)) return "fx";
  if (has(/(playback|\bbase\b|instrumental|\bpb\b)/)) return "playback";
  return "other";
}

export type Group = "vocals" | "drums" | "bass" | "other";

export type RoleCfg = {
  group: Group;
  /** Filtro passa-altas (Hz). */
  hpf: number;
  /** Volume padrão relativo à voz principal (LU). */
  level: number;
  /** Compressão: razão, quanto acima do nível médio fica o limiar (dB), ataque e liberação (ms). */
  comp: { ratio: number; above: number; attack: number; release: number } | null;
  /** Equalização de caráter (presença, ar, corpo). */
  eq: { f: number; g: number; q: number; shelf?: "low" | "high" }[];
  /** Envio para o reverb (0–1, multiplicado pelo estilo). */
  reverb: number;
  /** Abre espaço para a voz (−2 dB em 2,5–3,5 kHz quando há voz). */
  carve: boolean;
  /** Expansor para limpar vazamento/ruído entre as frases ou batidas. */
  gate: boolean;
  /** Busca de ressonâncias (cortes estreitos). */
  resonances: boolean;
};

export const ROLE: Record<TrackRole, RoleCfg> = {
  lead_vocal: { group: "vocals", hpf: 90, level: 0, comp: { ratio: 3, above: 2, attack: 8, release: 90 }, eq: [{ f: 250, g: -2, q: 1 }, { f: 3200, g: 2, q: 1 }, { f: 11000, g: 2.5, q: 0.7, shelf: "high" }], reverb: 1, carve: false, gate: true, resonances: true },
  backing_vocal: { group: "vocals", hpf: 140, level: -7, comp: { ratio: 4, above: 1, attack: 6, release: 80 }, eq: [{ f: 300, g: -3, q: 1 }, { f: 10000, g: 2, q: 0.7, shelf: "high" }], reverb: 1.3, carve: false, gate: true, resonances: true },
  kick: { group: "drums", hpf: 30, level: -4, comp: { ratio: 4, above: 6, attack: 15, release: 70 }, eq: [{ f: 60, g: 2, q: 1.2 }, { f: 350, g: -3, q: 1.2 }, { f: 4000, g: 2, q: 1.5 }], reverb: 0, carve: false, gate: true, resonances: false },
  snare: { group: "drums", hpf: 80, level: -4, comp: { ratio: 4, above: 6, attack: 12, release: 90 }, eq: [{ f: 200, g: 1.5, q: 1.2 }, { f: 900, g: -1.5, q: 1.5 }, { f: 6000, g: 2, q: 0.7, shelf: "high" }], reverb: 0.5, carve: false, gate: true, resonances: true },
  hihat: { group: "drums", hpf: 300, level: -14, comp: null, eq: [{ f: 10000, g: 1, q: 0.7, shelf: "high" }], reverb: 0.2, carve: false, gate: false, resonances: false },
  toms: { group: "drums", hpf: 60, level: -9, comp: { ratio: 3, above: 6, attack: 15, release: 120 }, eq: [{ f: 400, g: -3, q: 1.2 }, { f: 4000, g: 2, q: 1.5 }], reverb: 0.4, carve: false, gate: true, resonances: true },
  overheads: { group: "drums", hpf: 150, level: -10, comp: { ratio: 2, above: 4, attack: 20, release: 150 }, eq: [{ f: 400, g: -2, q: 1 }, { f: 12000, g: 1.5, q: 0.7, shelf: "high" }], reverb: 0.2, carve: false, gate: false, resonances: false },
  room: { group: "drums", hpf: 80, level: -16, comp: { ratio: 4, above: 0, attack: 10, release: 150 }, eq: [], reverb: 0, carve: false, gate: false, resonances: false },
  drums: { group: "drums", hpf: 30, level: -3, comp: { ratio: 2.5, above: 4, attack: 20, release: 120 }, eq: [{ f: 400, g: -1.5, q: 1 }, { f: 8000, g: 1, q: 0.7, shelf: "high" }], reverb: 0.15, carve: false, gate: false, resonances: false },
  percussion: { group: "drums", hpf: 150, level: -11, comp: { ratio: 2, above: 6, attack: 15, release: 120 }, eq: [], reverb: 0.5, carve: false, gate: false, resonances: false },
  bass: { group: "bass", hpf: 35, level: -4, comp: { ratio: 4, above: 2, attack: 20, release: 120 }, eq: [{ f: 80, g: 1.5, q: 1 }, { f: 250, g: -2, q: 1 }, { f: 1200, g: 1.5, q: 1.2 }], reverb: 0, carve: false, gate: false, resonances: false },
  electric_guitar: { group: "other", hpf: 90, level: -7, comp: { ratio: 2, above: 4, attack: 25, release: 150 }, eq: [{ f: 300, g: -1.5, q: 1 }, { f: 9000, g: -1, q: 0.7, shelf: "high" }], reverb: 0.5, carve: true, gate: true, resonances: false },
  acoustic_guitar: { group: "other", hpf: 100, level: -7, comp: { ratio: 2.5, above: 3, attack: 15, release: 120 }, eq: [{ f: 200, g: -2, q: 1 }, { f: 10000, g: 2, q: 0.7, shelf: "high" }], reverb: 0.6, carve: true, gate: true, resonances: true },
  piano: { group: "other", hpf: 60, level: -7, comp: { ratio: 2, above: 4, attack: 20, release: 150 }, eq: [{ f: 300, g: -1.5, q: 1 }, { f: 9000, g: 1, q: 0.7, shelf: "high" }], reverb: 0.6, carve: true, gate: false, resonances: false },
  keys: { group: "other", hpf: 80, level: -9, comp: { ratio: 2, above: 4, attack: 25, release: 150 }, eq: [{ f: 350, g: -1.5, q: 1 }], reverb: 0.6, carve: true, gate: false, resonances: false },
  synth: { group: "other", hpf: 60, level: -9, comp: { ratio: 2, above: 4, attack: 20, release: 150 }, eq: [], reverb: 0.4, carve: true, gate: false, resonances: false },
  pad: { group: "other", hpf: 120, level: -12, comp: null, eq: [{ f: 400, g: -2, q: 0.8 }], reverb: 0.5, carve: true, gate: false, resonances: false },
  strings: { group: "other", hpf: 100, level: -10, comp: { ratio: 1.5, above: 4, attack: 40, release: 250 }, eq: [{ f: 300, g: -1.5, q: 1 }], reverb: 0.8, carve: true, gate: false, resonances: false },
  brass: { group: "other", hpf: 120, level: -9, comp: { ratio: 2, above: 4, attack: 15, release: 120 }, eq: [{ f: 300, g: -1.5, q: 1 }], reverb: 0.6, carve: true, gate: false, resonances: false },
  fx: { group: "other", hpf: 150, level: -15, comp: null, eq: [], reverb: 0.4, carve: false, gate: false, resonances: false },
  loop: { group: "drums", hpf: 40, level: -8, comp: { ratio: 2, above: 4, attack: 20, release: 120 }, eq: [], reverb: 0.1, carve: false, gate: false, resonances: false },
  /** Base pronta (playback/instrumental): pouco tratamento, só espaço para a voz e volume. */
  playback: { group: "other", hpf: 30, level: -2.5, comp: null, eq: [], reverb: 0, carve: true, gate: false, resonances: false },
  other: { group: "other", hpf: 60, level: -9, comp: { ratio: 2, above: 4, attack: 20, release: 150 }, eq: [], reverb: 0.4, carve: true, gate: false, resonances: false },
};

export type GenreProfile = {
  name: string;
  /** Ajuste do volume padrão de cada papel (LU). */
  level: Partial<Record<TrackRole, number>>;
  /** Reverb: tamanho da sala (0–100), pré-atraso (ms) e envio geral. */
  reverb: { room: number; predelay: number; send: number };
  /** Voz acima do instrumental (LU de curto prazo) que a automação de volume busca. */
  vocalOverMusic: number;
  /** Abertura estéreo de guitarras/violões dobrados. */
  spread: number;
};

export const GENRE: Record<MixGenre, GenreProfile> = {
  pop: { name: "Pop", level: {}, reverb: { room: 65, predelay: 25, send: 0.12 }, vocalOverMusic: 2.5, spread: 0.7 },
  pop_us: { name: "Pop americano", level: { kick: 1, snare: 1, synth: 1 }, reverb: { room: 60, predelay: 20, send: 0.1 }, vocalOverMusic: 2.5, spread: 0.8 },
  worship: { name: "Worship", level: { pad: 3, electric_guitar: 1, kick: -1, snare: -1 }, reverb: { room: 88, predelay: 40, send: 0.2 }, vocalOverMusic: 1.5, spread: 0.85 },
  gospel: { name: "Gospel", level: { keys: 2, backing_vocal: 1, bass: 1 }, reverb: { room: 80, predelay: 30, send: 0.16 }, vocalOverMusic: 2, spread: 0.7 },
  sertanejo: { name: "Sertanejo", level: { acoustic_guitar: 2, keys: 1, kick: -1, snare: -1 }, reverb: { room: 70, predelay: 30, send: 0.14 }, vocalOverMusic: 3, spread: 0.7 },
  pagode: { name: "Pagode/Samba", level: { percussion: 4, acoustic_guitar: 1, bass: 1 }, reverb: { room: 55, predelay: 20, send: 0.1 }, vocalOverMusic: 2.5, spread: 0.6 },
  funk: { name: "Funk BR", level: { kick: 3, bass: 3, snare: 1, other: -2 }, reverb: { room: 40, predelay: 10, send: 0.05 }, vocalOverMusic: 1, spread: 0.6 },
  rock: { name: "Rock", level: { electric_guitar: 3, kick: 1, snare: 1, bass: 1 }, reverb: { room: 50, predelay: 15, send: 0.08 }, vocalOverMusic: 0.5, spread: 0.9 },
  trap: { name: "Trap/Hip-hop", level: { kick: 2, bass: 3, hihat: 3, snare: 1 }, reverb: { room: 40, predelay: 10, send: 0.06 }, vocalOverMusic: 1.5, spread: 0.6 },
  acoustic: { name: "Acústico", level: { acoustic_guitar: 3, piano: 2, kick: -3, snare: -3, drums: -3 }, reverb: { room: 70, predelay: 25, send: 0.14 }, vocalOverMusic: 3, spread: 0.6 },
  edm: { name: "EDM/Eletrônica", level: { synth: 3, kick: 2, bass: 2, pad: 1 }, reverb: { room: 75, predelay: 30, send: 0.12 }, vocalOverMusic: 1.5, spread: 0.8 },
  lofi: { name: "Lo-fi", level: { keys: 1, drums: -1 }, reverb: { room: 60, predelay: 20, send: 0.15 }, vocalOverMusic: 1.5, spread: 0.5 },
  mpb: { name: "MPB", level: { acoustic_guitar: 2, piano: 1, kick: -2, snare: -2 }, reverb: { room: 70, predelay: 25, send: 0.12 }, vocalOverMusic: 2.5, spread: 0.6 },
};

/** Volume-alvo de um papel no estilo, relativo à voz principal. */
export const targetLevel = (role: TrackRole, genre: MixGenre) => ROLE[role].level + (GENRE[genre].level[role] ?? 0);
