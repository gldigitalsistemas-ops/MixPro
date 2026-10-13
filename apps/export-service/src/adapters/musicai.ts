/**
 * Separação premium pela API da Music.AI (empresa do Moises): voz, bateria, baixo, teclado/piano,
 * violão e guitarra separados. O áudio vai pela URL temporária de envio deles, o job é acompanhado
 * até terminar, as faixas são baixadas e o job é APAGADO lá (nada do usuário fica com terceiros).
 *
 * Variáveis: MUSICAI_API_KEY, MUSICAI_WORKFLOW (slug do workflow criado no painel da Music.AI com os
 * módulos de faixas), MUSICAI_USD_PER_MIN (custo para o painel de margem; padrão 0,48).
 */
export interface StemSeparator {
  /** Devolve os arquivos de cada faixa (nome da saída do workflow → bytes). */
  separate(audio: Uint8Array, contentType: string, signal?: AbortSignal): Promise<Record<string, Uint8Array>>;
  usdPerMinute: number;
}

export class MusicAiUnavailable extends Error {}
export class MusicAiFailed extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const BASE = "https://api.music.ai/v1";

export class MusicAiSeparator implements StemSeparator {
  usdPerMinute: number;
  constructor(
    private key: string,
    private workflow: string,
    private opts: { pollMs?: number; maxWaitMs?: number; fetchFn?: typeof fetch; usdPerMinute?: number } = {},
  ) {
    this.usdPerMinute = opts.usdPerMinute ?? 0.48;
  }

  private f(path: string, init: RequestInit = {}) {
    return (this.opts.fetchFn ?? fetch)(`${BASE}${path}`, { ...init, headers: { Authorization: this.key, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  }

  async separate(audio: Uint8Array, contentType: string, signal?: AbortSignal): Promise<Record<string, Uint8Array>> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const up = await this.f("/upload", { signal });
    if (!up.ok) throw new MusicAiFailed(`UPLOAD_URL_${up.status}`);
    const { uploadUrl, downloadUrl } = (await up.json()) as { uploadUrl: string; downloadUrl: string };
    const put = await fetchFn(uploadUrl, { method: "PUT", body: audio as BodyInit, headers: { "Content-Type": contentType }, signal });
    if (!put.ok) throw new MusicAiFailed(`UPLOAD_${put.status}`);
    const created = await this.f("/job", { method: "POST", body: JSON.stringify({ name: "mixpro", workflow: this.workflow, params: { inputUrl: downloadUrl } }), signal });
    if (!created.ok) throw new MusicAiFailed(`JOB_${created.status}`);
    const { id } = (await created.json()) as { id: string };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const deadline = Date.now() + (this.opts.maxWaitMs ?? 20 * 60_000);
    try {
      for (;;) {
        if (Date.now() > deadline) throw new MusicAiFailed("TIMEOUT");
        await sleep(this.opts.pollMs ?? 4000);
        const st = await this.f(`/job/${encodeURIComponent(id)}`, { signal });
        if (!st.ok) continue;
        const job = (await st.json()) as { status: string; result?: Record<string, unknown>; error?: { code?: string } };
        if (job.status === "FAILED") throw new MusicAiFailed(job.error?.code ?? "FAILED");
        if (job.status !== "SUCCEEDED") continue;
        const out: Record<string, Uint8Array> = {};
        for (const [name, url] of Object.entries(job.result ?? {})) {
          if (typeof url !== "string" || !/^https:\/\//.test(url)) continue;
          const r = await fetchFn(url, { signal });
          if (!r.ok) throw new MusicAiFailed(`DOWNLOAD_${r.status}`);
          out[name] = new Uint8Array(await r.arrayBuffer());
        }
        return out;
      }
    } finally {
      // apaga o job (e os arquivos) na Music.AI
      await this.f(`/job/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    }
  }
}

export function musicAiFromEnv(env: Record<string, string | undefined> = process.env): StemSeparator | null {
  if (!env.MUSICAI_API_KEY || !env.MUSICAI_WORKFLOW) return null;
  const usd = Number(env.MUSICAI_USD_PER_MIN);
  return new MusicAiSeparator(env.MUSICAI_API_KEY, env.MUSICAI_WORKFLOW, { usdPerMinute: Number.isFinite(usd) && usd > 0 ? usd : 0.48 });
}

/** Qual faixa do Mix Pro corresponde a cada saída do workflow (pelo nome, em inglês ou português). */
export function stemOf(outputName: string): "voz" | "bateria" | "baixo" | "teclado" | "violao" | "guitarra" | null {
  const n = outputName.toLowerCase();
  if (/(vocal|voice|voz)/.test(n) && !/(back|other)/.test(n)) return "voz";
  if (/(drum|bateria)/.test(n)) return "bateria";
  if (/(bass|baixo)/.test(n)) return "baixo";
  if (/(piano|key|teclado|synth)/.test(n)) return "teclado";
  if (/(acoustic|violao|violão)/.test(n)) return "violao";
  if (/(electric|guitar|guitarra)/.test(n)) return "guitarra";
  return null;
}
