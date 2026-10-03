/**
 * Tratamento dos samples de bateria e das caixas (IR) depois de decodificados: o mesmo no
 * navegador (lib/drums/library.ts, que decodifica com OfflineAudioContext) e em Node
 * (lib/export/node-assets.ts, que lê o WAV direto). Sem DOM.
 */
import type { DrumSampleSet, DrumSlot } from "@/lib/dsp/drums/studio";

export type Layers = { close: Float32Array[]; room: Float32Array[] };
type LibraryItem = { id: string; files: string[]; room_files?: string[] };

/** Média dos canais. */
export function monoOf(channels: Float32Array[]): Float32Array {
  const mono = new Float32Array(channels[0]?.length ?? 0);
  for (let c = 0; c < channels.length; c++) {
    const d = channels[c];
    for (let i = 0; i < mono.length; i++) mono[i] += d[i] / channels.length;
  }
  return mono;
}

/** IR mono na taxa do áudio, até 250 ms, com a energia normalizada. */
export function irFromChannels(channels: Float32Array[], sampleRate: number): Float32Array {
  const len = Math.min(channels[0].length, Math.round(sampleRate * 0.25));
  const out = new Float32Array(len);
  for (let c = 0; c < channels.length; c++) {
    const d = channels[c];
    for (let i = 0; i < len; i++) out[i] += d[i] / channels.length;
  }
  let e = 0;
  for (let i = 0; i < len; i++) e += out[i] * out[i];
  const g = e > 0 ? 1 / Math.sqrt(e) : 1;
  for (let i = 0; i < len; i++) out[i] *= g;
  return out;
}

const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Onde o ataque começa (primeira amostra acima de 2% do pico, com 0,5 ms de folga). */
function attackStart(x: Float32Array, sr: number): number {
  const peak = peakOf(x);
  let start = 0;
  while (start < x.length && Math.abs(x[start]) < peak * 0.02) start++;
  return Math.max(0, start - Math.round(sr * 0.0005));
}

/** Recorta a partir de `start` até o som morrer (-60 dB, máx. 3 s), com fade e pico em `norm`. */
function cut(x: Float32Array, start: number, sr: number, norm: number): Float32Array {
  const peak = peakOf(x);
  if (peak < 1e-6) return new Float32Array(1);
  let end = x.length - 1;
  while (end > start && Math.abs(x[end]) < peak * 0.001) end--;
  end = Math.min(end + 1, start + Math.round(sr * 3));
  const out = x.slice(start, end);
  const fade = Math.min(out.length, Math.round(sr * 0.02));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/**
 * Camadas do tambor, da batida mais leve à mais forte. A sala de cada batida é cortada no mesmo
 * ponto que o microfone de perto (mantém o atraso natural da sala) e no mesmo ganho relativo.
 * `decodeMono(caminho)` = o arquivo do Storage já em mono, na taxa do áudio.
 */
export async function buildLayers(item: LibraryItem, sampleRate: number, decodeMono: (path: string) => Promise<Float32Array>): Promise<Layers> {
  const layers = await Promise.all(
    item.files.map(async (path, i) => {
      const close = await decodeMono(path);
      const roomPath = item.room_files?.[i];
      const room = roomPath ? await decodeMono(roomPath) : null;
      const start = attackStart(close, sampleRate);
      const peak = peakOf(close) || 1;
      let loud = 0;
      for (let k = start; k < Math.min(close.length, start + sampleRate * 0.05); k++) loud += close[k] * close[k];
      return { loud, close: cut(close, start, sampleRate, peak), room: room ? cut(room, start, sampleRate, peak) : null };
    }),
  );
  layers.sort((a, b) => a.loud - b.loud);
  const withRoom = layers.every((l) => l.room);
  return { close: layers.map((l) => l.close), room: withRoom ? layers.map((l) => l.room!) : [] };
}

/** Monta o conjunto de samples das peças escolhidas; "synth" e ids desconhecidos ficam de fora. */
export async function sampleSetFrom<T extends LibraryItem>(
  choices: Partial<Record<DrumSlot, string>>,
  library: T[],
  layersOf: (item: T) => Promise<Layers>,
): Promise<DrumSampleSet> {
  const set: DrumSampleSet = { rooms: {} };
  await Promise.all(
    (Object.entries(choices) as [DrumSlot, string][]).map(async ([slot, id]) => {
      const item = library.find((s) => s.id === id);
      if (!item) return;
      const layers = await layersOf(item);
      set[slot] = layers.close;
      if (layers.room.length) set.rooms![slot] = layers.room;
    }),
  );
  return set;
}
