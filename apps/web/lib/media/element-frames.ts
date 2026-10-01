"use client";

/**
 * Leitura de quadros pelo player de vídeo do navegador (<video> + canvas), reserva para quando o
 * decodificador do WebCodecs falha. No iPhone isso acontece com vídeos HEVC em HDR (10 bits /
 * Dolby Vision, o padrão da câmera dos iPhones recentes): o Safari toca o vídeo, mas o
 * VideoDecoder devolve "EncodingError: Decoder failure". O player sempre consegue (e já aplica a
 * rotação e converte o HDR para a tela). É mais lento (posiciona o vídeo em cada quadro), por isso
 * só entra quando o caminho rápido falha.
 */

/** Arquivos em que o WebCodecs já falhou: as próximas leituras vão direto pelo player. */
const codecsFailed = new WeakSet<File>();

export const prefersElement = (file: File) => codecsFailed.has(file);
export const markCodecsFailed = (file: File) => codecsFailed.add(file);

/** Falha do decodificador do navegador (não é erro do app nem do arquivo). */
export function isDecodeFailure(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? "";
  return name === "EncodingError" || name === "OperationError" || /decod|codec|buffer has no frame/i.test(String(e?.message ?? err));
}

type Canvas = HTMLCanvasElement | OffscreenCanvas;

export class ElementFrameReader {
  private constructor(
    private video: HTMLVideoElement,
    private url: string,
  ) {}

  get width() {
    return this.video.videoWidth;
  }
  get height() {
    return this.video.videoHeight;
  }
  get duration() {
    return this.video.duration;
  }

  static async open(file: File): Promise<ElementFrameReader> {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.setAttribute("playsinline", "");
    // no iPhone o vídeo fora da página às vezes não decodifica: fica na página, invisível
    Object.assign(video.style, { position: "fixed", left: "-10px", top: "-10px", width: "2px", height: "2px", opacity: "0", pointerEvents: "none" });
    document.body.appendChild(video);
    video.src = url;
    const reader = new ElementFrameReader(video, url);
    try {
      await reader.until("loadeddata", 20000);
    } catch (err) {
      reader.close();
      throw err;
    }
    return reader;
  }

  private until(event: string, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const v = this.video;
      const done = () => {
        clearTimeout(timer);
        v.removeEventListener(event, done);
        v.removeEventListener("error", fail);
        resolve();
      };
      const fail = () => {
        clearTimeout(timer);
        v.removeEventListener(event, done);
        v.removeEventListener("error", fail);
        reject(new DOMException("O player não conseguiu ler este vídeo.", "EncodingError"));
      };
      const timer = setTimeout(fail, ms);
      v.addEventListener(event, done, { once: true });
      v.addEventListener("error", fail, { once: true });
    });
  }

  /** Posiciona o vídeo em `t` (s) e desenha o quadro em `canvas` (esticado para o tamanho dele). */
  async drawAt(t: number, canvas: Canvas): Promise<void> {
    const v = this.video;
    const target = Math.min(Math.max(0, t), Math.max(0, (v.duration || t) - 0.001));
    if (Math.abs(v.currentTime - target) > 0.0005 || v.readyState < 2) {
      const seeked = this.until("seeked", 8000);
      v.currentTime = target;
      await seeked;
    }
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new DOMException("Sem canvas 2D.", "NotSupportedError");
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
  }

  /** Quadros de `start` a `end` (s) a `fps`, num canvas reaproveitado de `w`×`h`. */
  async *frames(start: number, end: number, fps: number, w: number, h: number): AsyncGenerator<{ canvas: Canvas; timestamp: number; duration: number }> {
    const canvas: Canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const step = 1 / fps;
    for (let t = start; t < end - 1e-4; t += step) {
      await this.drawAt(t, canvas);
      yield { canvas, timestamp: t, duration: Math.min(step, end - t) };
    }
  }

  close() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
    URL.revokeObjectURL(this.url);
  }
}
