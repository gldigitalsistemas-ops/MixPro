"use client";

/**
 * executeExportJob: executor LOCAL (no aparelho) de um ExportJob. Faz exatamente o caminho que o
 * export-panel fazia: áudio tratado (runDsp, com cache) → arquivo do vídeo (cópia salva no iPhone)
 * → render quadro a quadro ou só troca do áudio → ou arquivo de áudio (cortes → música → gravação).
 * Login, crédito, desbloqueio de kit e o fluxo "sem internet" continuam no painel.
 */
import type { ExportJob } from "@mixpro/contracts";
import { ensureCaptionFont } from "@/lib/captions/font";
import type { DrumSampleSet } from "@/lib/dsp/drums/studio";
import { runDsp, type DspResult } from "@/lib/dsp/runner";
import type { Signal } from "@/lib/dsp/types";
import { beforeAfterAudio } from "@/lib/media/before-after";
import type { AudiogramStyle } from "@/lib/media/compose";
import { lookOf, rendersVideo } from "./look";
import { spliceAudio, type Segment } from "@/lib/media/cuts";
import { MediaError, exportAudio, exportVideo, type ExportResult } from "@/lib/media/export";
import { readableFile } from "@/lib/media/file-access";
import type { LoadedMedia } from "@/lib/media/load";
import { mixMusic, safeCeiling } from "@/lib/media/music";
import { renderVideo } from "@/lib/media/render";

export const FILE_GONE =
  "O celular liberou o vídeo que você escolheu e ele não pode mais ser lido. Toque em “Trocar” e escolha o mesmo vídeo de novo: suas escolhas continuam salvas.";

export type ExecuteContext = {
  /** O arquivo e o áudio decodificado (o job só referencia). */
  media: LoadedMedia;
  /** Samples e IRs já carregados na taxa do arquivo. */
  drumSamples?: DrumSampleSet;
  impulses?: Record<string, Float32Array>;
  /** Música de fundo já preparada (prepareMusic) e a imagem do audiograma. */
  music: Signal | null;
  audiogramImage: ImageBitmap | null;
  /** Cache do áudio tratado entre exportações (chave = job.audio.audio_ref). */
  cache: { current: { key: string; value: DspResult } | null };
  onPhase: (label: string, progress: number) => void;
};

// visual do job e decisão de render ficam em ./look (puro, também usado pelo servidor)
export { lookOf, rendersVideo } from "./look";

async function processFull(job: ExportJob, ctx: ExecuteContext): Promise<DspResult> {
  const key = job.audio.audio_ref;
  if (ctx.cache.current?.key === key) return ctx.cache.current.value;
  const { media } = ctx;
  const denoise = job.audio.denoise;
  const value = await runDsp(
    {
      channels: media.channels,
      sampleRate: media.sampleRate,
      chain: job.audio.chain,
      intensity: job.audio.intensity,
      social: job.audio.social.enabled,
      delivery: { targetLufs: job.audio.social.target_lufs, ceilingDb: job.audio.social.ceiling_db },
      denoise,
      drumSamples: ctx.drumSamples,
      impulses: ctx.impulses,
    },
    (p) => ctx.onPhase(denoise > 0 && p < 0.5 ? "Removendo o ruído de fundo…" : "Aplicando o som no arquivo inteiro…", p * 100),
  );
  ctx.cache.current = { key, value };
  return value;
}

export async function executeExportJob(job: ExportJob, ctx: ExecuteContext): Promise<ExportResult> {
  const { media } = ctx;
  const target = job.output.target;
  const segments: Segment[] = job.cuts.segments;
  const cutting = job.cuts.applied;
  const look = lookOf(job);
  const music = ctx.music;
  const level = job.audio.music?.level;
  const withMusic = (a: Signal) =>
    music && level ? safeCeiling(mixMusic(a, music, media.sampleRate, level, 0, a[0].length), media.sampleRate) : a;

  ctx.onPhase("Aplicando o som no arquivo inteiro…", 0);
  const processed = await processFull(job, ctx);
  // no iPhone o vídeo escolhido da Galeria pode ter sido apagado pelo sistema: usa a cópia salva no aparelho
  const file = target === "video" ? await readableFile(media.file) : media.file;
  if (!file) throw new MediaError(FILE_GONE);
  const src = file === media.file ? media : { ...media, file };

  if (target === "video") {
    const compare = job.look.before_after;
    const render = rendersVideo(job);
    const label = media.kind === "audio" ? "Criando o audiograma…" : render ? "Montando o vídeo quadro a quadro…" : "Montando o vídeo com o som novo…";
    ctx.onPhase(label, 0);
    const onProgress = (p: number) => ctx.onPhase(label, p * 100);
    if (render) {
      await ensureCaptionFont();
      let audio = processed.channels;
      let finalLook = look;
      if (compare) {
        const ba = beforeAfterAudio(media.channels, processed.channels, media.sampleRate, media.audioStart, segments);
        audio = ba.audio;
        finalLook = { ...look, beforeAfter: { split: ba.split } };
      }
      const g = job.look.audiogram;
      const audiogram: AudiogramStyle | null = g ? { palette: g.palette, title: g.title, image: g.has_image ? ctx.audiogramImage : null } : null;
      return renderVideo({ media: src, audio, segments, look: finalLook, audiogram, postAudio: withMusic, onProgress });
    }
    return exportVideo(src, withMusic(processed.channels), onProgress);
  }

  const label = "Gerando o arquivo de áudio…";
  ctx.onPhase(label, 0);
  const audio = withMusic(cutting ? spliceAudio(processed.channels, media.sampleRate, media.audioStart, segments) : processed.channels);
  return exportAudio(src, audio, target, (p) => ctx.onPhase(label, p * 100));
}
