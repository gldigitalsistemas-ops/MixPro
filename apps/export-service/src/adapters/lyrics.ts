/**
 * Letra e idioma cantado (Whisper large-v3 no Modal, ver infra/modal/lyrics_app.py).
 * Usado na Produção: idioma e letra da guia (para o prompt e o mapa) e o tempo de cada palavra cantada pela
 * voz guia da IA (para o mapa da letra). Variáveis: LYRICS_URL e COMPOSE_TOKEN (segredo compartilhado com o Modal).
 */
import type { HeardSegment } from "@/lib/mixengine/lyrics";

export type Transcript = { language: string; probability: number; segments: HeardSegment[] };

export interface LyricsService {
  transcribe(audioUrl: string, language?: string | null, signal?: AbortSignal): Promise<Transcript>;
}

export class HttpLyrics implements LyricsService {
  constructor(
    private url: string,
    private token: string,
    private opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  async transcribe(audioUrl: string, language?: string | null, signal?: AbortSignal): Promise<Transcript> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 10 * 60_000);
    signal?.addEventListener("abort", () => ctrl.abort());
    try {
      const res = await (this.opts.fetchFn ?? fetch)(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ audio_url: audioUrl, language: language ?? null }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const body = (await res.json()) as Transcript;
      if (!body || !Array.isArray(body.segments)) throw new Error("BAD_BODY");
      return body;
    } finally {
      clearTimeout(t);
    }
  }
}

export function lyricsFromEnv(env: Record<string, string | undefined> = process.env): LyricsService | null {
  if (!env.LYRICS_URL || !env.COMPOSE_TOKEN) return null;
  return new HttpLyrics(env.LYRICS_URL, env.COMPOSE_TOKEN);
}
