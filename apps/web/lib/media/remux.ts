/**
 * Troca o áudio de um vídeo por um áudio já codificado (AAC do servidor), SEM recodificar nada:
 * o vídeo original é copiado (pacotes iguais, resolução, proporção e FPS preservados) e os pacotes
 * de áudio do arquivo tratado entram como estão. O vídeo nunca sai do aparelho (Etapa 4, decisão 4).
 *
 * Só para MP4/MOV (AAC). Em WebM o app segue o caminho de hoje (Opus gerado no aparelho).
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import { MediaError, type ExportResult } from "./export";
import type { LoadedMedia } from "./load";

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "audio";

export async function remuxVideoWithAudio(
  media: Pick<LoadedMedia, "file" | "audioStart" | "videoContainer">,
  audio: Blob,
  onProgress: (v: number) => void,
): Promise<ExportResult> {
  if (media.videoContainer === "webm") throw new MediaError("Este vídeo é WebM: o áudio é gerado neste aparelho.");
  const video = new Input({ source: new BlobSource(media.file), formats: ALL_FORMATS });
  const sound = new Input({ source: new BlobSource(audio), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  try {
    const track = await sound.getPrimaryAudioTrack();
    const codec = track ? await track.getCodec() : null;
    if (!track || codec !== "aac") throw new MediaError("O áudio tratado não está no formato esperado. Tente de novo.");
    const decoderConfig = await track.getDecoderConfig();

    const conversion = await Conversion.init({ input: video, output, tracks: "primary", audio: { discard: true }, composable: true, showWarnings: false });
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.isVideoTrack())) {
      throw new MediaError("Não foi possível copiar o vídeo deste arquivo. Baixe o áudio e junte no CapCut.");
    }
    const source = new EncodedAudioPacketSource("aac");
    output.addAudioTrack(source);
    await output.start();

    const total = (await track.computeDuration()) || 1;
    let videoP = 0;
    let audioP = 0;
    const report = () => onProgress(Math.min(videoP, audioP));
    conversion.onProgress = (p) => {
      videoP = p;
      report();
    };
    const sink = new EncodedPacketSink(track);
    const feed = async () => {
      let first = true;
      for await (const packet of sink.packets()) {
        // o áudio tratado começa em 0 = instante em que o áudio começa no vídeo original
        const moved = media.audioStart ? packet.clone({ timestamp: packet.timestamp + media.audioStart }) : packet;
        await source.add(moved, first ? { decoderConfig: decoderConfig ?? undefined } : undefined);
        first = false;
        audioP = Math.min(1, packet.timestamp / total);
        report();
      }
      source.close();
      audioP = 1;
      report();
    };
    await Promise.all([conversion.execute(), feed()]);
    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new MediaError("Falha ao gerar o vídeo.");
    return { blob: new Blob([buffer], { type: "video/mp4" }), filename: `${baseName(media.file)}-mixpro.mp4` };
  } catch (err) {
    if (output.state !== "finalized") await output.cancel().catch(() => {});
    throw err;
  } finally {
    video.dispose();
    sound.dispose();
  }
}
