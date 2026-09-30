"use client";

/**
 * Biblioteca de samples de bateria (enviada pelo admin, no Storage público "drum-samples").
 * O app baixa só as peças escolhidas, decodifica já na taxa de amostragem do arquivo do
 * usuário e guarda em memória; o navegador também guarda os arquivos no cache.
 */
import type { DrumPiece } from "@mixpro/contracts";
import type { DrumSampleSet, DrumSlot } from "@/lib/dsp/drums/studio";
import { publicEnv } from "@/lib/public-env";
import { supabaseBrowser } from "@/lib/supabase/client";

export type DrumLibraryItem = {
  id: string;
  piece: DrumPiece;
  name: string;
  description: string | null;
  styles: string[];
  files: string[];
  active: boolean;
  position: number;
};

export const SLOT_PIECE: Record<DrumSlot, DrumPiece> = { kick: "kick", snare: "snare", tom1: "tom", tom2: "tom", floor: "floor" };
export const SLOT_PARAM: Record<DrumSlot, string> = {
  kick: "kick_sample",
  snare: "snare_sample",
  tom1: "tom1_sample",
  tom2: "tom2_sample",
  floor: "floor_sample",
};
export const SLOT_LABEL: Record<DrumSlot, string> = { kick: "Bumbo", snare: "Caixa", tom1: "Tom 1", tom2: "Tom 2", floor: "Surdo" };

export const BUCKET = "drum-samples";
export const sampleUrl = (path: string) => `${publicEnv.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;

export async function fetchDrumLibrary(includeInactive = false): Promise<DrumLibraryItem[]> {
  let q = supabaseBrowser().from("drum_samples").select("id, piece, name, description, styles, files, active, position").order("position").order("created_at");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as DrumLibraryItem[];
}

/** Opções da biblioteca para uma peça (o surdo também aceita tons, se não houver surdo). */
export function optionsFor(slot: DrumSlot, library: DrumLibraryItem[]): DrumLibraryItem[] {
  const piece = SLOT_PIECE[slot];
  const own = library.filter((s) => s.piece === piece);
  if (slot === "floor" && !own.length) return library.filter((s) => s.piece === "tom");
  return own;
}

/**
 * Sample de cada peça: o que está no preset (se existir na biblioteca), senão o padrão do estilo,
 * senão o primeiro da biblioteca; sem nada na biblioteca, "synth" (timbre sintetizado).
 */
export function resolveSample(slot: DrumSlot, value: string, kit: string, library: DrumLibraryItem[]): string {
  if (value === "synth") return "synth";
  const opts = optionsFor(slot, library);
  if (value && opts.some((o) => o.id === value)) return value;
  if (!opts.length) return "synth";
  const byStyle = opts.filter((o) => o.styles.includes(kit));
  const pool = byStyle.length ? byStyle : opts;
  // tom 2: o segundo tom do estilo (outra afinação), quando houver
  if (slot === "tom2" && pool.length > 1) return pool[1].id;
  // sem surdo na biblioteca: usa o último tom da lista (o admin ordena do agudo para o grave)
  if (slot === "floor" && pool[0].piece === "tom") return pool[pool.length - 1].id;
  return pool[0].id;
}

const cache = new Map<string, Promise<Float32Array[]>>();

/** Recorta o sample: começa no ataque, termina quando o som morre (-60 dB), pico 1. */
function prepare(buf: AudioBuffer): Float32Array {
  const n = buf.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak < 1e-6) return new Float32Array(1);
  let start = 0;
  while (start < n && Math.abs(mono[start]) < peak * 0.02) start++;
  start = Math.max(0, start - Math.round(buf.sampleRate * 0.0005));
  let end = n - 1;
  while (end > start && Math.abs(mono[end]) < peak * 0.001) end--;
  end = Math.min(end + 1, start + Math.round(buf.sampleRate * 3));
  const out = mono.slice(start, end);
  const fade = Math.min(out.length, Math.round(buf.sampleRate * 0.02));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}

/** Força da camada: energia dos primeiros 50 ms antes de normalizar (para ordenar leve → forte). */
function loudness(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  const len = Math.min(d.length, Math.round(buf.sampleRate * 0.05));
  let s = 0;
  for (let i = 0; i < len; i++) s += d[i] * d[i];
  return s;
}

export function loadLayers(item: DrumLibraryItem, sampleRate: number): Promise<Float32Array[]> {
  const key = `${item.id}@${sampleRate}`;
  let p = cache.get(key);
  if (!p) {
    p = Promise.all(
      item.files.map(async (path) => {
        const res = await fetch(sampleUrl(path), { cache: "force-cache" });
        if (!res.ok) throw new Error(`sample ${path}: ${res.status}`);
        const ctx = new OfflineAudioContext(1, 1, sampleRate);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        return { data: prepare(buf), loud: loudness(buf) };
      }),
    ).then((layers) => layers.sort((a, b) => a.loud - b.loud).map((l) => l.data));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Carrega as peças escolhidas (ids por posição); "synth" e ids desconhecidos ficam de fora. */
export async function loadSampleSet(choices: Partial<Record<DrumSlot, string>>, library: DrumLibraryItem[], sampleRate: number): Promise<DrumSampleSet> {
  const set: DrumSampleSet = {};
  await Promise.all(
    (Object.entries(choices) as [DrumSlot, string][]).map(async ([slot, id]) => {
      const item = library.find((s) => s.id === id);
      if (item) set[slot] = await loadLayers(item, sampleRate);
    }),
  );
  return set;
}
