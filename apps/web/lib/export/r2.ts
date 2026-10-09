/**
 * Cliente mínimo do Cloudflare R2 (API compatível com S3, assinatura SigV4) sem dependências:
 * só node:crypto e fetch. Usado pelas rotas da Vercel (URLs pré-assinadas) e pelo serviço de
 * exportação (leitura da entrada e gravação da saída). O mesmo código nos dois lados.
 *
 * Segredos: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (nunca no cliente).
 * Chaves: só `in/<uuid>` e `out/<uuid>.<ext>` (aleatórias), nunca o nome do arquivo do usuário.
 */
import { createHash, createHmac } from "node:crypto";
import { PassThrough, Readable } from "node:stream";

export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

export function r2ConfigFromEnv(env: Record<string, string | undefined> = process.env): R2Config {
  const accountId = env.R2_ACCOUNT_ID ?? "";
  const accessKeyId = env.R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY ?? "";
  const bucket = env.R2_BUCKET ?? "";
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) throw new Error("R2 não configurado (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)");
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

const sha256hex = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const hmac = (key: string | Buffer, v: string) => createHmac("sha256", key).update(v).digest();
/** Codificação de URI do S3: tudo, exceto A-Z a-z 0-9 - _ . ~ (e "/" no caminho). */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function stamp(now: Date) {
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz, date: amz.slice(0, 8) };
}

/** Pedido com URL e cabeçalhos já assinados. */
export type SignedRequest = { url: string; method: string; headers: Record<string, string> };

export class R2Client {
  private host: string;
  constructor(
    private cfg: R2Config,
    /** Relógio injetável (testes). */
    private now: () => Date = () => new Date(),
  ) {
    this.host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  }

  private path(key: string) {
    return `/${this.cfg.bucket}/${key.split("/").map(enc).join("/")}`;
  }

  private signingKey(date: string) {
    return hmac(hmac(hmac(hmac("AWS4" + this.cfg.secretAccessKey, date), "auto"), "s3"), "aws4_request");
  }

  /** Pedido assinado por cabeçalhos (Authorization). `body` entra no hash do conteúdo. */
  sign(method: string, key: string, body: Uint8Array | string = "", extraHeaders: Record<string, string> = {}): SignedRequest {
    const { amz, date } = stamp(this.now());
    const payloadHash = sha256hex(body);
    const headers: Record<string, string> = { host: this.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amz, ...extraHeaders };
    const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const path = this.path(key);
    const canonical = [method, path, "", names.map((h) => `${h}:${lower[h]}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const scope = `${date}/auto/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amz, scope, sha256hex(canonical)].join("\n");
    const signature = createHmac("sha256", this.signingKey(date)).update(toSign).digest("hex");
    const out = { ...lower, authorization: `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
    delete (out as Record<string, string>).host;
    return { url: `https://${this.host}${path}`, method, headers: out };
  }

  /**
   * URL pré-assinada (GET ou PUT). Em PUT, `contentLength` é assinado: o R2 recusa o envio se o
   * tamanho real for diferente do declarado (o teto de tamanho vale também no upload direto).
   */
  presign(method: "GET" | "PUT", key: string, expiresS: number, opts: { contentLength?: number; downloadName?: string } = {}): string {
    if (expiresS < 1 || expiresS > 3600) throw new Error("validade da URL deve ficar entre 1 e 3600 s");
    const { amz, date } = stamp(this.now());
    const scope = `${date}/auto/s3/aws4_request`;
    const signed = opts.contentLength !== undefined ? ["content-length", "host"] : ["host"];
    const q: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.cfg.accessKeyId}/${scope}`,
      "X-Amz-Date": amz,
      "X-Amz-Expires": String(Math.floor(expiresS)),
      "X-Amz-SignedHeaders": signed.join(";"),
    };
    // GET: o navegador baixa como arquivo (em vez de tocar na aba), com um nome genérico
    if (method === "GET" && opts.downloadName) {
      if (!/^[a-zA-Z0-9._-]{1,80}$/.test(opts.downloadName)) throw new Error("nome de download inválido");
      q["response-content-disposition"] = `attachment; filename="${opts.downloadName}"`;
    }
    const qs = Object.keys(q)
      .sort()
      .map((k) => `${enc(k)}=${enc(q[k])}`)
      .join("&");
    const headersCanon = signed.map((h) => (h === "host" ? `host:${this.host}\n` : `content-length:${opts.contentLength}\n`)).join("");
    const canonical = [method, this.path(key), qs, headersCanon, signed.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", amz, scope, sha256hex(canonical)].join("\n");
    const signature = createHmac("sha256", this.signingKey(date)).update(toSign).digest("hex");
    return `https://${this.host}${this.path(key)}?${qs}&X-Amz-Signature=${signature}`;
  }

  private async call(method: string, key: string, body?: Uint8Array) {
    const r = this.sign(method, key, body ?? "");
    return fetch(r.url, { method, headers: r.headers, body: body as BodyInit | undefined });
  }

  /** Tamanho em bytes, ou null se o objeto não existe. */
  async head(key: string): Promise<{ size: number } | null> {
    const res = await this.call("HEAD", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new R2Error("head", res.status);
    return { size: Number(res.headers.get("content-length") ?? 0) };
  }

  /** Leitura em fluxo. Erros chegam no próprio fluxo. */
  read(key: string): Readable {
    const out = new PassThrough();
    this.call("GET", key)
      .then(async (res) => {
        if (!res.ok || !res.body) return out.destroy(new R2Error("get", res.status));
        Readable.fromWeb(res.body as never).pipe(out);
      })
      .catch((e) => out.destroy(e));
    return out;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const res = await this.call("PUT", key, data);
    if (!res.ok) throw new R2Error("put", res.status);
  }

  async delete(key: string): Promise<void> {
    const res = await this.call("DELETE", key);
    if (!res.ok && res.status !== 404) throw new R2Error("delete", res.status);
  }
}

/** Erro do R2 com só a operação e o status HTTP (nunca a resposta nem a chave). */
export class R2Error extends Error {
  constructor(
    public op: string,
    public status: number,
  ) {
    super(`R2 ${op}: HTTP ${status}`);
  }
}
