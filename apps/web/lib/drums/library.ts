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
  /** As mesmas batidas pelos microfones de sala (opcional, mesma ordem). */
  room_files: string[];
  active: boolean;
  position: number;
};

export type DrumKit = {
  id: string;
  name: string;
  description: string | null;
  styles: string[];
  kick_id: string | null;
  snare_id: string | null;
  tom1_id: string | null;
  tom2_id: string | null;
  floor_id: string | null;
  rimshot_id: string | null;
  price_credits: number;
  active: boolean;
  position: number;
};

export type CabIR = { id: string; kind: "guitar" | "bass"; name: string; description: string | null; file: string; active: boolean; position: number };

export const SLOT_PIECE: Record<DrumSlot, DrumPiece> = { kick: "kick", snare: "snare", tom1: "tom", tom2: "tom", floor: "floor", rimshot: "rimshot" };
export const SLOT_PARAM: Record<DrumSlot, string> = {
  kick: "kick_sample",
  snare: "snare_sample",
  tom1: "tom1_sample",
  tom2: "tom2_sample",
  floor: "floor_sample",
  rimshot: "rimshot_sample",
};
export const SLOT_LABEL: Record<DrumSlot, string> = { kick: "Bumbo", snare: "Caixa", tom1: "Tom 1", tom2: "Tom 2", floor: "Surdo", rimshot: "Caixa com aro" };
export const KIT_FIELD: Record<DrumSlot, keyof DrumKit> = {
  kick: "kick_id",
  snare: "snare_id",
  tom1: "tom1_id",
  tom2: "tom2_id",
  floor: "floor_id",
  rimshot: "rimshot_id",
};

/** Um só Storage público para samples e IRs (IRs na pasta ir/). */
export const BUCKET = "drum-samples";
export const sampleUrl = (path: string) => `${publicEnv.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;

export async function fetchDrumLibrary(includeInactive = false): Promise<DrumLibraryItem[]> {
  const sb = supabaseBrowser();
  const query = (cols: string) => {
    let q = sb.from("drum_samples").select(cols).order("position").order("created_at");
    if (!includeInactive) q = q.eq("active", true);
    return q;
  };
  let res = await query("id, piece, name, description, styles, files, room_files, active, position");
  // antes da migração dos microfones de sala a coluna não existe
  if (res.error) res = await query("id, piece, name, description, styles, files, active, position");
  if (res.error) throw res.error;
  return ((res.data ?? []) as unknown as DrumLibraryItem[]).map((s) => ({ ...s, room_files: s.room_files ?? [] }));
}

export async function fetchDrumKits(includeInactive = false): Promise<DrumKit[]> {
  let q = supabaseBrowser().from("drum_kits").select("*").order("position").order("created_at");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) return []; // sem a migração dos kits: segue sem kits
  return (data ?? []) as DrumKit[];
}

/** Kits premium já desbloqueados pelo usuário logado. */
export async function fetchUnlockedKits(): Promise<Set<string>> {
  const { data } = await supabaseBrowser().from("kit_unlocks").select("kit_id");
  return new Set((data ?? []).map((r) => r.kit_id as string));
}

export async function unlockKit(kitId: string): Promise<number> {
  const { data, error } = await supabaseBrowser().rpc("unlock_drum_kit", { p_kit: kitId });
  if (error) throw error;
  return data as number;
}

export async function fetchIRs(includeInactive = false): Promise<CabIR[]> {
  let q = supabaseBrowser().from("cab_irs").select("*").order("position").order("created_at");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as CabIR[];
}

const irCache = new Map<string, Promise<Float32Array>>();

/** IR mono na taxa do áudio, até 250 ms, com a energia normalizada. */
export function loadIR(ir: CabIR, sampleRate: number): Promise<Float32Array> {
  const key = `${ir.id}@${sampleRate}`;
  let p = irCache.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(sampleUrl(ir.file), { cache: "force-cache" });
      if (!res.ok) throw new Error(`IR ${ir.file}: ${res.status}`);
      const buf = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(await res.arrayBuffer());
      const len = Math.min(buf.length, Math.round(sampleRate * 0.25));
      const out = new Float32Array(len);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) out[i] += d[i] / buf.numberOfChannels;
      }
      let e = 0;
      for (let i = 0; i < len; i++) e += out[i] * out[i];
      const g = e > 0 ? 1 / Math.sqrt(e) : 1;
      for (let i = 0; i < len; i++) out[i] *= g;
      return out;
    })();
    p.catch(() => irCache.delete(key));
    irCache.set(key, p);
  }
  return p;
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
  // o aro só entra quando o preset ou o kit pede (e nunca um sample de kit pago por acaso)
  if (!opts.length || slot === "rimshot") return "synth";
  const byStyle = opts.filter((o) => o.styles.includes(kit));
  const pool = byStyle.length ? byStyle : opts;
  // tom 2: o segundo tom do estilo (outra afinação), quando houver
  if (slot === "tom2" && pool.length > 1) return pool[1].id;
  // sem surdo na biblioteca: usa o último tom da lista (o admin ordena do agudo para o grave)
  if (slot === "floor" && pool[0].piece === "tom") return pool[pool.length - 1].id;
  return pool[0].id;
}

type Layers = { close: Float32Array[]; room: Float32Array[] };
const cache = new Map<string, Promise<Layers>>();

function toMono(buf: AudioBuffer): Float32Array {
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < buf.length; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  return mono;
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

async function decode(path: string, sampleRate: number): Promise<Float32Array> {
  const res = await fetch(sampleUrl(path), { cache: "force-cache" });
  if (!res.ok) throw new Error(`sample ${path}: ${res.status}`);
  return toMono(await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(await res.arrayBuffer()));
}

/**
 * Camadas do tambor, da batida mais leve à mais forte. A sala de cada batida é cortada no mesmo
 * ponto que o microfone de perto (mantém o atraso natural da sala) e no mesmo ganho relativo.
 */
export function loadLayers(item: DrumLibraryItem, sampleRate: number): Promise<Layers> {
  const key = `${item.id}@${sampleRate}`;
  let p = cache.get(key);
  if (!p) {
    p = Promise.all(
      item.files.map(async (path, i) => {
        const close = await decode(path, sampleRate);
        const roomPath = item.room_files?.[i];
        const room = roomPath ? await decode(roomPath, sampleRate) : null;
        const start = attackStart(close, sampleRate);
        const peak = peakOf(close) || 1;
        let loud = 0;
        for (let k = start; k < Math.min(close.length, start + sampleRate * 0.05); k++) loud += close[k] * close[k];
        return { loud, close: cut(close, start, sampleRate, peak), room: room ? cut(room, start, sampleRate, peak) : null };
      }),
    ).then((layers) => {
      layers.sort((a, b) => a.loud - b.loud);
      const withRoom = layers.every((l) => l.room);
      return { close: layers.map((l) => l.close), room: withRoom ? layers.map((l) => l.room!) : [] };
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Carrega as peças escolhidas (ids por posição); "synth" e ids desconhecidos ficam de fora. */
export async function loadSampleSet(choices: Partial<Record<DrumSlot, string>>, library: DrumLibraryItem[], sampleRate: number): Promise<DrumSampleSet> {
  const set: DrumSampleSet = { rooms: {} };
  await Promise.all(
    (Object.entries(choices) as [DrumSlot, string][]).map(async ([slot, id]) => {
      const item = library.find((s) => s.id === id);
      if (!item) return;
      const layers = await loadLayers(item, sampleRate);
      set[slot] = layers.close;
      if (layers.room.length) set.rooms![slot] = layers.room;
    }),
  );
  return set;
}

/** Algum dos samples escolhidos tem microfones de sala? */
export const hasRoomMics = (choices: Partial<Record<DrumSlot, string>>, library: DrumLibraryItem[]) =>
  Object.values(choices).some((id) => (library.find((s) => s.id === id)?.room_files.length ?? 0) > 0);

const kitSamples = (k: DrumKit) => (Object.values(KIT_FIELD) as (keyof DrumKit)[]).map((f) => k[f]).filter(Boolean) as string[];

/**
 * Kits premium que o usuário precisa desbloquear para baixar com as escolhas atuais.
 * Um sample só é pago se aparece apenas em kits premium ainda não desbloqueados
 * (se também estiver num kit grátis ou já desbloqueado, é livre).
 */
export function lockedKitsFor(choices: Partial<Record<DrumSlot, string>>, kits: DrumKit[], unlocked: Set<string>): DrumKit[] {
  const open = (k: DrumKit) => k.price_credits <= 0 || unlocked.has(k.id);
  const needed = new Map<string, DrumKit>();
  for (const id of new Set(Object.values(choices))) {
    const containing = kits.filter((k) => kitSamples(k).includes(id!));
    if (!containing.length || containing.some(open)) continue;
    const cheapest = containing.reduce((a, b) => (b.price_credits < a.price_credits ? b : a));
    needed.set(cheapest.id, cheapest);
  }
  return [...needed.values()];
}
