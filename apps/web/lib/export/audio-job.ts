/**
 * Parte de ÁUDIO de um ExportJob, sem DOM: o mesmo caminho do executeExportJob para arquivo de
 * áudio (DSP → cortes → música de fundo), lendo só job.audio, job.cuts e job.source.
 * O visual (formato, cor, CTA, antes → depois) não entra: não muda o som, só o p_ref.
 * Usado pelo script do servidor e pelos testes; no navegador o DSP roda no worker (runDsp).
 */
import type { ExportJob } from "@mixpro/contracts";
import type { DrumSampleSet } from "@/lib/dsp/drums/studio";
import type { Signal } from "@/lib/dsp/types";
import { spliceAudio } from "@/lib/media/cuts";
import { mixMusic, safeCeiling } from "@/lib/media/music";
import { processAudio } from "./process-audio";

export type JobAudioInputs = {
  drumSamples?: DrumSampleSet;
  impulses?: Record<string, Float32Array>;
  /** Música de fundo já preparada (prepareMusic), quando o job tiver. */
  music?: Signal | null;
};

export async function processJobAudio(job: ExportJob, channels: Signal, sampleRate: number, inputs: JobAudioInputs = {}): Promise<Signal> {
  const processed = await processAudio(channels, sampleRate, {
    chain: job.audio.chain,
    intensity: job.audio.intensity,
    social: job.audio.social.enabled,
    denoise: job.audio.denoise,
    preroll: 0,
    drumSamples: inputs.drumSamples,
    impulses: inputs.impulses,
  });
  const out = job.cuts.applied ? spliceAudio(processed.channels, sampleRate, job.source.audio_start_s, job.cuts.segments) : processed.channels;
  if (!job.audio.music) return out;
  if (!inputs.music) throw new Error("o job tem música de fundo e ela não foi fornecida");
  return safeCeiling(mixMusic(out, inputs.music, sampleRate, job.audio.music.level, 0, out[0].length), sampleRate);
}
