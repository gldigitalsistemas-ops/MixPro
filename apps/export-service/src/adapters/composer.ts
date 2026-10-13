/**
 * Gerador de bases (Produção da composição): serviço em GPU (Modal, ACE-Step 1.5 — licença MIT) que
 * recebe a voz da guia e gera o acompanhamento no estilo pedido. Ver infra/modal/acestep_app.py.
 *
 * O áudio vai e volta por URLs temporárias do nosso R2 (o gerador nunca guarda nada). Variáveis:
 * COMPOSE_URL (endpoint do Modal), COMPOSE_TOKEN (segredo compartilhado), COMPOSE_USD_PER_RUN
 * (custo estimado por geração para o painel de margem; padrão 0,02).
 */
export type ComposeRequest = {
  /** Voz da guia (URL temporária de leitura) e, opcionalmente, a referência de som. */
  guideUrl: string;
  referenceUrl: string | null;
  /** Uma URL temporária de gravação por versão (WAV 44,1 kHz estéreo). */
  outputUrls: string[];
  seeds: number[];
  genre: string;
  style: string;
  lyrics?: string;
  bpm: number;
  key: string | null;
  durationS: number;
};

export interface Composer {
  generate(req: ComposeRequest, signal?: AbortSignal): Promise<void>;
  usdPerRun: number;
}

export class ComposerFailed extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export class HttpComposer implements Composer {
  usdPerRun: number;
  constructor(
    private url: string,
    private token: string,
    private opts: { fetchFn?: typeof fetch; usdPerRun?: number; timeoutMs?: number } = {},
  ) {
    this.usdPerRun = opts.usdPerRun ?? 0.02;
  }

  async generate(req: ComposeRequest, signal?: AbortSignal): Promise<void> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15 * 60_000);
    signal?.addEventListener("abort", () => ctrl.abort());
    try {
      const res = await (this.opts.fetchFn ?? fetch)(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          guide_url: req.guideUrl,
          reference_url: req.referenceUrl,
          output_urls: req.outputUrls,
          seeds: req.seeds,
          genre: req.genre,
          style: req.style,
          lyrics: req.lyrics ?? "",
          bpm: req.bpm,
          key: req.key,
          duration_s: req.durationS,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new ComposerFailed(`HTTP_${res.status}`);
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!body?.ok) throw new ComposerFailed(body?.error?.slice(0, 40) ?? "FAILED");
    } finally {
      clearTimeout(t);
    }
  }
}

export function composerFromEnv(env: Record<string, string | undefined> = process.env): Composer | null {
  if (!env.COMPOSE_URL || !env.COMPOSE_TOKEN) return null;
  const usd = Number(env.COMPOSE_USD_PER_RUN);
  return new HttpComposer(env.COMPOSE_URL, env.COMPOSE_TOKEN, { usdPerRun: Number.isFinite(usd) && usd > 0 ? usd : 0.02 });
}
