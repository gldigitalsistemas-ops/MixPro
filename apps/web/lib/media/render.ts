"use client";

import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import type { Signal } from "@/lib/dsp/types";
import { composeAudiogram, composeFrame, envelope, outputSize, type AudiogramStyle, type Look } from "./compose";
import { keptDuration, spliceAudio, type Segment } from "./cuts";
import { MediaError, type ExportResult } from "./export";
import type { LoadedMedia } from "./load";

const FPS_AUDIOGRAM = 30;

async function audioCodecReady(channels: number, sampleRate: number) {
  const opts = { numberOfChannels: channels, sampleRate, quality: QUALITY_HIGH };
  if (!(await canEncodeAudio("aac", opts))) (await import("@mediabunny/aac-encoder")).registerAacEncoder();
  if (!(await canEncodeAudio("aac", opts))) throw new MediaError("Este navegador não consegue gerar o vídeo. Tente pelo Chrome.");
}

async function feedAudio(source: AudioBufferSource, channels: Signal, sampleRate: number, onProgress: (v: number) => void) {
  const step = sampleRate;
  const total = channels[0].length;
  for (let pos = 0; pos < total; pos += step) {
    const len = Math.min(step, total - pos);
    const buf = new AudioBuffer({ length: len, numberOfChannels: channels.length, sampleRate });
    channels.forEach((ch, c) => buf.copyToChannel(ch.subarray(pos, pos + len), c));
    await source.add(buf);
    onProgress((pos + len) / total);
  }
  source.close();
}

/**
 * Gera o vídeo final quadro a quadro: pula os trechos cortados, aplica formato,
 * legendas e selo — ou cria o audiograma quando o arquivo é só áudio.
 * `audio` = áudio tratado, na linha do tempo do original (começa em media.audioStart).
 */
export async function renderVideo(opts: {
  media: LoadedMedia;
  audio: Signal;
  segments: Segment[];
  look: Look;
  audiogram: AudiogramStyle | null;
  /** Aplicado ao áudio já emendado (ex.: música de fundo). */
  postAudio?: (audio: Signal) => Signal;
  onProgress: (v: number) => void;
}): Promise<ExportResult> {
  const { media, segments, look } = opts;
  const sr = media.sampleRate;
  const spliced = spliceAudio(opts.audio, sr, media.audioStart, segments);
  const outAudio = opts.postAudio ? opts.postAudio(spliced) : spliced;
  const duration = keptDuration(segments);
  await audioCodecReady(outAudio.length, sr);

  const input = media.kind === "video" ? new Input({ source: new BlobSource(media.file), formats: ALL_FORMATS }) : null;
  const track = input ? await input.getPrimaryVideoTrack() : null;
  const srcW = track?.displayWidth ?? 1080;
  const srcH = track?.displayHeight ?? 1920;
  const size = track
    ? outputSize(srcW, srcH, look.format)
    : outputSize(1080, 1920, look.format === "original" ? "9:16" : look.format);

  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "av1"], { ...size, quality: QUALITY_HIGH });
  if (!codec) throw new MediaError("Este navegador não consegue gerar vídeo. Baixe o áudio ou use o Chrome.");

  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d")!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH });
  const audioSource = new AudioBufferSource({ codec: "aac", quality: QUALITY_HIGH });
  output.addVideoTrack(videoSource, { frameRate: track ? undefined : FPS_AUDIOGRAM });
  output.addAudioTrack(audioSource);

  let videoP = 0;
  let audioP = 0;
  const report = () => opts.onProgress(Math.min(videoP, audioP));

  try {
    await output.start();

    const video = async () => {
      if (track) {
        // lê já em tamanho reduzido (a rotação do celular é aplicada pelo sink)
        const scale = Math.min(1, (Math.max(size.width, size.height) * 1.05) / Math.max(srcW, srcH));
        const sink = new CanvasSink(track, {
          width: Math.max(2, Math.round(srcW * scale)),
          height: Math.max(2, Math.round(srcH * scale)),
          fit: "fill",
          poolSize: 2,
        });
        let outBase = 0;
        for (const seg of segments) {
          const segLen = seg.end - seg.start;
          for await (const { canvas: frame, timestamp, duration: d } of sink.canvases(seg.start, seg.end)) {
            const rel = Math.max(0, timestamp - seg.start);
            const dur = Math.max(0.001, Math.min(d, segLen - rel));
            ctx.clearRect(0, 0, size.width, size.height);
            composeFrame(ctx, size.width, size.height, frame, frame.width, frame.height, Math.max(timestamp, seg.start), look);
            await videoSource.add(outBase + rel, dur);
            videoP = (outBase + rel) / duration;
            report();
          }
          outBase += segLen;
        }
      } else {
        const env = envelope(outAudio, sr, FPS_AUDIOGRAM);
        const frames = Math.ceil(duration * FPS_AUDIOGRAM);
        let segIdx = 0;
        let segOut = 0;
        for (let f = 0; f < frames; f++) {
          const tOut = f / FPS_AUDIOGRAM;
          while (segIdx < segments.length - 1 && tOut >= segOut + (segments[segIdx].end - segments[segIdx].start)) {
            segOut += segments[segIdx].end - segments[segIdx].start;
            segIdx++;
          }
          const tSrc = segments[segIdx].start + (tOut - segOut);
          composeAudiogram(ctx, size.width, size.height, f, env, tSrc, opts.audiogram!, look);
          await videoSource.add(tOut, 1 / FPS_AUDIOGRAM);
          videoP = f / frames;
          report();
        }
      }
      videoSource.close();
      videoP = 1;
      report();
    };

    await Promise.all([
      video(),
      feedAudio(audioSource, outAudio, sr, (p) => {
        audioP = p;
        report();
      }),
    ]);
    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new MediaError("Falha ao gerar o vídeo.");
    const name = media.file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "video";
    return { blob: new Blob([buffer], { type: "video/mp4" }), filename: `${name}-mixpro.mp4` };
  } catch (err) {
    if (output.state !== "finalized") await output.cancel().catch(() => {});
    throw err;
  } finally {
    input?.dispose();
  }
}
