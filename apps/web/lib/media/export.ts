"use client";

import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeAudio,
  type AudioCodec,
  type ConversionVideoOptions,
  type InputVideoTrack,
  type VideoSample,
} from "mediabunny";
import { drawCaptions, type CaptionRender } from "@/lib/captions/model";
import type { Signal } from "@/lib/dsp/types";
import type { LoadedMedia } from "./load";

export type AudioFormat = "wav" | "mp3" | "m4a";
export type ExportResult = { blob: Blob; filename: string };

const CHUNK_SECONDS = 1;

/** Carrega o codificador em WebAssembly só quando o navegador não tem um nativo. */
async function ensureEncoder(codec: AudioCodec, numberOfChannels: number, sampleRate: number): Promise<boolean> {
  const opts = { numberOfChannels, sampleRate, quality: QUALITY_HIGH };
  if (await canEncodeAudio(codec, opts)) return true;
  if (codec === "aac") (await import("@mediabunny/aac-encoder")).registerAacEncoder();
  else if (codec === "mp3") (await import("@mediabunny/mp3-encoder")).registerMp3Encoder();
  else return false;
  return canEncodeAudio(codec, opts);
}

/** Envia o áudio processado ao codificador em blocos de 1 s, respeitando a contrapressão. */
async function feed(source: AudioBufferSource, channels: Signal, sampleRate: number, onProgress: (v: number) => void) {
  const total = channels[0].length;
  const step = Math.round(CHUNK_SECONDS * sampleRate);
  for (let pos = 0; pos < total; pos += step) {
    const len = Math.min(step, total - pos);
    const buf = new AudioBuffer({ length: len, numberOfChannels: channels.length, sampleRate });
    channels.forEach((ch, c) => buf.copyToChannel(ch.subarray(pos, pos + len), c));
    await source.add(buf);
    onProgress((pos + len) / total);
  }
  source.close();
}

function baseName(file: File) {
  return file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "audio";
}

const MAX_SHORT_SIDE = 1080;

/**
 * Com legendas, cada quadro é desenhado num canvas com o texto e recodificado
 * (limitado a 1080p no lado menor); sem legendas o vídeo é copiado sem perdas.
 */
function captionVideoOptions(track: InputVideoTrack, webm: boolean, captions: CaptionRender): ConversionVideoOptions {
  // displayWidth/Height já consideram a rotação (vídeo de celular em pé sai em pé)
  const w0 = track.displayWidth;
  const h0 = track.displayHeight;
  const scale = Math.min(1, MAX_SHORT_SIDE / Math.min(w0, h0));
  const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
  const width = even(w0);
  const height = even(h0);
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  return {
    forceTranscode: true,
    allowTransformationMetadata: false,
    codec: webm ? "vp9" : "avc",
    quality: QUALITY_HIGH,
    width,
    height,
    fit: "contain",
    process: (sample: VideoSample) => {
      if (!canvas || canvas.width !== sample.displayWidth || canvas.height !== sample.displayHeight) {
        canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
        ctx = canvas.getContext("2d");
      }
      sample.draw(ctx!, 0, 0, canvas.width, canvas.height);
      drawCaptions(ctx!, canvas.width, canvas.height, sample.timestamp, captions);
      return canvas;
    },
    processedWidth: width,
    processedHeight: height,
  };
}

/** Vídeo original + áudio tratado (e legendas, se houver), no mesmo contêiner. */
export async function exportVideo(
  media: LoadedMedia,
  processed: Signal,
  onProgress: (v: number) => void,
  captions?: CaptionRender | null,
): Promise<ExportResult> {
  const webm = media.videoContainer === "webm";
  const codec: AudioCodec = webm ? "opus" : "aac";
  if (!(await ensureEncoder(codec, processed.length, media.sampleRate))) {
    throw new Error("Este navegador não consegue gerar o vídeo. Baixe o áudio e junte no CapCut, ou use o Chrome.");
  }

  const input = new Input({ source: new BlobSource(media.file), formats: ALL_FORMATS });
  const output = new Output({
    format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      audio: { discard: true },
      video: captions ? (track) => captionVideoOptions(track, webm, captions) : undefined,
      composable: true,
      showWarnings: false,
    });
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.isVideoTrack())) {
      throw new Error("Não foi possível copiar o vídeo deste arquivo. Baixe o áudio e junte no CapCut.");
    }
    const source = new AudioBufferSource({ codec, quality: QUALITY_HIGH }, { startTimestamp: media.audioStart });
    output.addAudioTrack(source);
    await output.start();

    let videoP = 0;
    let audioP = 0;
    const report = () => onProgress(Math.min(videoP, audioP));
    conversion.onProgress = (p) => {
      videoP = p;
      report();
    };
    await Promise.all([
      conversion.execute(),
      feed(source, processed, media.sampleRate, (p) => {
        audioP = p;
        report();
      }),
    ]);
    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new Error("Falha ao gerar o vídeo.");
    return {
      blob: new Blob([buffer], { type: webm ? "video/webm" : "video/mp4" }),
      filename: `${baseName(media.file)}-mixpro.${webm ? "webm" : "mp4"}`,
    };
  } catch (err) {
    if (output.state !== "finalized") await output.cancel().catch(() => {});
    throw err;
  } finally {
    input.dispose();
  }
}

/** WAV PCM 16 bits com dither TPDF (máxima compatibilidade: CapCut, InShot, celulares). */
function encodeWav(channels: Signal, sampleRate: number): Blob {
  const nch = channels.length;
  const n = channels[0].length;
  const dataBytes = n * nch * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, nch, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * nch * 2, true);
  view.setUint16(32, nch * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const dither = (Math.random() - Math.random()) / 32768;
      const v = Math.max(-1, Math.min(1, channels[c][i] + dither));
      view.setInt16(o, Math.round(v * 32767), true);
      o += 2;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

export async function exportAudio(
  media: LoadedMedia,
  processed: Signal,
  format: AudioFormat,
  onProgress: (v: number) => void,
): Promise<ExportResult> {
  const filename = `${baseName(media.file)}-mixpro.${format}`;
  if (format === "wav") {
    const blob = encodeWav(processed, media.sampleRate);
    onProgress(1);
    return { blob, filename };
  }

  const codec: AudioCodec = format === "mp3" ? "mp3" : "aac";
  if (!(await ensureEncoder(codec, processed.length, media.sampleRate))) {
    throw new Error(`Este navegador não consegue gerar ${format.toUpperCase()}. Baixe em WAV.`);
  }
  const output = new Output({
    format: format === "mp3" ? new Mp3OutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const source = new AudioBufferSource({ codec, quality: QUALITY_HIGH });
  output.addAudioTrack(source);
  await output.start();
  await feed(source, processed, media.sampleRate, onProgress);
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("Falha ao gerar o arquivo de áudio.");
  return { blob: new Blob([buffer], { type: format === "mp3" ? "audio/mpeg" : "audio/mp4" }), filename };
}
