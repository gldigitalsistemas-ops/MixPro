/**
 * Samples de bateria e caixas (IR) de um ExportJob, carregados em Node (serviço do servidor e
 * script run-export-job). Baixa do bucket público "drum-samples" (só leitura, sem chave), guarda
 * em disco e aplica o MESMO tratamento do app (lib/drums/asset-process.ts).
 *
 * Diferença conhecida: o app decodifica com OfflineAudioContext NA TAXA DO ÁUDIO do usuário. Os
 * arquivos da biblioteca são WAV 16 bits / 48 kHz; com áudio a 48 kHz a leitura aqui é idêntica à do
 * Chrome. Com outra taxa (ex.: 44,1 kHz) o Chrome reamostra com o algoritmo dele e aqui usamos o
 * do app (lib/dsp/resample): o resultado fica próximo, mas não bit a bit (`approximate: true`).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExportJob } from "@mixpro/contracts";
import { CABS, isBuiltinCab, synthCabIR } from "@/lib/dsp/cab-ir";
import type { DrumSampleSet, DrumSlot } from "@/lib/dsp/drums/studio";
import { resample } from "@/lib/dsp/resample";
import { buildLayers, irFromChannels, monoOf, sampleSetFrom } from "@/lib/drums/asset-process";
import { SLOT_PARAM } from "@/lib/drums/tweaks";
import { decodeWav } from "./wav";

export const BUCKET = "drum-samples";

export type AssetSource = {
  /** URL do projeto Supabase (a pública, a mesma do app). */
  storageUrl: string;
  /** Pasta do cache em disco (os arquivos do Storage nunca mudam: cada envio tem um UUID novo). */
  cacheDir: string;
};

export type LoadedAssets = {
  drumSamples?: DrumSampleSet;
  impulses?: Record<string, Float32Array>;
  /** Algum arquivo precisou ser reamostrado (resultado próximo do app, mas não idêntico). */
  approximate: boolean;
  downloads: number;
  cacheHits: number;
};

export async function loadJobAssets(job: ExportJob, sampleRate: number, src: AssetSource): Promise<LoadedAssets> {
  const stats = { approximate: false, downloads: 0, cacheHits: 0 };
  await mkdir(src.cacheDir, { recursive: true });

  async function bytesOf(path: string): Promise<Uint8Array> {
    const file = join(src.cacheDir, createHash("sha256").update(path).digest("hex").slice(0, 32) + ".wav");
    try {
      const cached = await readFile(file);
      stats.cacheHits++;
      return cached;
    } catch {
      const url = `${src.storageUrl.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(url);
      if (res.status === 401 || res.status === 403) throw new Error(`o bucket ${BUCKET} pediu autenticação (${res.status})`);
      if (!res.ok) throw new Error(`asset ${path}: ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      await writeFile(file, buf);
      stats.downloads++;
      return buf;
    }
  }

  /** Canais na taxa do áudio (como o OfflineAudioContext do app entrega). */
  async function decodeAt(path: string): Promise<Float32Array[]> {
    const wav = decodeWav(await bytesOf(path));
    if (wav.sampleRate === sampleRate) return wav.channels;
    stats.approximate = true;
    return wav.channels.map((c) => resample(c, wav.sampleRate, sampleRate));
  }

  // bateria: as peças escolhidas estão na própria cadeia (o app carrega as mesmas)
  let drumSamples: DrumSampleSet | undefined;
  const drum = job.audio.chain.chain.find((m) => m.type === "drum_studio");
  if (drum) {
    const params = (drum.params ?? {}) as Record<string, unknown>;
    const choices = Object.fromEntries(
      (Object.entries(SLOT_PARAM) as [DrumSlot, string][]).map(([slot, key]) => [slot, String(params[key] ?? "")]),
    ) as Record<DrumSlot, string>;
    const library = job.audio.assets.drum_samples.filter((a) => !a.builtin);
    drumSamples = await sampleSetFrom(choices, library, (item) => buildLayers(item, sampleRate, async (p) => monoOf(await decodeAt(p))));
  }

  // caixas: as do Mix Pro são geradas aqui mesmo; as enviadas vêm do Storage
  const impulses: Record<string, Float32Array> = {};
  for (const ir of job.audio.assets.irs) {
    const builtin = isBuiltinCab(ir.id) ? CABS.find((c) => c.id === ir.id) : undefined;
    if (builtin) impulses[ir.id] = synthCabIR(builtin, sampleRate);
    else if (ir.file) impulses[ir.id] = irFromChannels(await decodeAt(ir.file), sampleRate);
  }

  return { drumSamples, impulses: Object.keys(impulses).length ? impulses : undefined, ...stats };
}
