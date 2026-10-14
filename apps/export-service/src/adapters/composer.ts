/**
 * Gerador da Produção da composição: MiniMax Music Cover, pela WaveSpeed (a MiniMax não abre mais a API direta
 * para clientes novos). Recebe a guia (URL temporária do nosso R2, MP3) e um prompt de estilo de até 300
 * caracteres; devolve a música completa com uma voz de IA cantando a melodia da guia. O app tira essa voz
 * (vira a voz guia) e entrega o instrumental.
 *
 * Variáveis: WAVESPEED_API_KEY (segredo), COMPOSE_USD_PER_RUN (custo por versão para o painel; padrão 0,15).
 */
export type CoverRequest = { audioUrl: string; prompt: string };

export interface Composer {
  cover(req: CoverRequest, signal?: AbortSignal): Promise<Uint8Array>;
  usdPerRun: number;
}

export class ComposerFailed extends Error {
  constructor(public code: string) {
    super(code);
  }
}

type FetchFn = typeof fetch;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ComposerFailed("ABORTED"));
    });
  });

export class WaveSpeedCover implements Composer {
  usdPerRun: number;
  constructor(
    private apiKey: string,
    private opts: { fetchFn?: FetchFn; usdPerRun?: number; timeoutMs?: number; pollMs?: number; base?: string } = {},
  ) {
    this.usdPerRun = opts.usdPerRun ?? 0.15;
  }

  private async json(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const res = await (this.opts.fetchFn ?? fetch)(url, { ...init, headers: { Authorization: `Bearer ${this.apiKey}`, ...(init.body ? { "Content-Type": "application/json" } : {}) } });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body) throw new ComposerFailed(`HTTP_${res.status}`);
    return ((body.data as Record<string, unknown>) ?? body) as Record<string, unknown>;
  }

  async cover(req: CoverRequest, signal?: AbortSignal): Promise<Uint8Array> {
    const base = this.opts.base ?? "https://api.wavespeed.ai/api/v3";
    const deadline = Date.now() + (this.opts.timeoutMs ?? 15 * 60_000);
    const task = await this.json(`${base}/minimax/music-cover`, { method: "POST", body: JSON.stringify({ prompt: req.prompt.slice(0, 300), audio: req.audioUrl }), signal });
    const id = String(task.id ?? "");
    if (!id) throw new ComposerFailed("NO_TASK");
    while (Date.now() < deadline) {
      await sleep(this.opts.pollMs ?? 4000, signal);
      const r = await this.json(`${base}/predictions/${id}/result`, { signal }).catch((e) => {
        // falha momentânea na consulta não derruba a geração: tenta de novo na próxima volta
        if (e instanceof ComposerFailed && /^HTTP_5/.test(e.code)) return { status: "processing" } as Record<string, unknown>;
        throw e;
      });
      const status = String(r.status ?? "");
      if (status === "completed") {
        const url = (r.outputs as string[] | undefined)?.[0];
        if (!url) throw new ComposerFailed("NO_OUTPUT");
        const audio = await (this.opts.fetchFn ?? fetch)(url, { signal });
        if (!audio.ok) throw new ComposerFailed(`DOWNLOAD_${audio.status}`);
        return new Uint8Array(await audio.arrayBuffer());
      }
      if (["failed", "cancelled", "timeout", "deleted"].includes(status)) throw new ComposerFailed(status.toUpperCase());
    }
    throw new ComposerFailed("TIMEOUT");
  }
}

export function composerFromEnv(env: Record<string, string | undefined> = process.env): Composer | null {
  const key = env.WAVESPEED_API_KEY?.trim();
  if (!key) return null;
  const usd = Number(env.COMPOSE_USD_PER_RUN);
  return new WaveSpeedCover(key, { usdPerRun: Number.isFinite(usd) && usd > 0 ? usd : 0.15 });
}
