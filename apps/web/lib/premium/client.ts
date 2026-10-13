/**
 * Cliente dos módulos premium no navegador: identificador do aparelho (para a 1ª experiência), envio
 * direto ao Cofre do projeto com progresso real e as chamadas da API.
 */
import type { PremiumId, PremiumQuote, ProjectProduct } from "@mixpro/contracts";
import { put } from "@/lib/export/server-client";

const DID_KEY = "mixpro.did";

function randomHex(bytes: number) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identificador aleatório deste aparelho (localStorage + cookie de 1 ano). Não identifica a pessoa. */
export function deviceId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(DID_KEY);
  } catch {}
  if (!id) id = document.cookie.match(/(?:^|; )mpdid=([a-f0-9]{32})/)?.[1] ?? null;
  if (!id || !/^[a-f0-9]{32}$/.test(id)) id = randomHex(16);
  try {
    localStorage.setItem(DID_KEY, id);
  } catch {}
  document.cookie = `mpdid=${id}; max-age=31536000; path=/; samesite=lax; secure`;
  return id;
}

/** Assinatura técnica do navegador (tela, idioma, fuso, núcleos…), em hash. Nada pessoal. */
export async function browserFingerprint(): Promise<string> {
  const n = navigator as Navigator & { deviceMemory?: number };
  const raw = [
    n.userAgent,
    n.language,
    n.platform,
    n.hardwareConcurrency,
    n.deviceMemory ?? "",
    n.maxTouchPoints,
    screen.width,
    screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(h).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class PremiumError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new PremiumError("OFFLINE", "Sem conexão. Verifique a internet e tente de novo.");
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) throw new PremiumError(body?.code ?? "INTERNAL", body?.error ?? "Não foi possível agora. Tente de novo em instantes.");
  return body as T;
}

export type JobView = { id: string; status: string; progress: number; errorCode: string | null; message: string | null; measures: Record<string, unknown> | null; outputs: { name: string; bytes: number; url: string }[] };

export type ProjectState = {
  project: { id: string; product: ProjectProduct; title: string; status: string; minutes: number; revisions: number; params: Record<string, unknown>; inputMeta: { name: string; bytes: number; role?: string }[]; parentId: string | null; expiresAt: string };
  paid: boolean;
  owner: boolean;
  order: { id: string; product: PremiumId; status: string; price_brl: number; list_price_brl: number; intro: boolean; method: string; paid_at: string | null } | null;
  preview: JobView | null;
  final: JobView | null;
};

/** Cria o projeto e envia os arquivos (progresso de 0 a 1 somando todos). */
export async function createProject(
  product: ProjectProduct,
  files: { file: File | Blob; name: string; role?: string }[],
  onProgress: (v: number) => void,
  opts: { title?: string; parentId?: string | null } = {},
): Promise<string> {
  const r = await call<{ project_id: string; uploads: string[] }>("/api/premium/projects", {
    method: "POST",
    body: JSON.stringify({ product, title: opts.title, parent_id: opts.parentId ?? undefined, files: files.map((f) => ({ name: f.name, bytes: f.file.size, role: f.role })) }),
  });
  const total = files.reduce((a, f) => a + f.file.size, 0) || 1;
  let sent = 0;
  for (let i = 0; i < files.length; i++) {
    const before = sent;
    await put(r.uploads[i], files[i].file, (p) => onProgress((before + p * files[i].file.size) / total), undefined, () => new XMLHttpRequest()).catch(() => {
      throw new PremiumError("UPLOAD", `O envio de “${files[i].name}” não foi concluído. Verifique a internet e tente de novo.`);
    });
    sent += files[i].file.size;
  }
  return r.project_id;
}

export const projectState = (id: string) => call<ProjectState>(`/api/premium/projects/${id}`);
export const startPreview = (id: string, params: unknown) => call<{ job_id: string }>(`/api/premium/projects/${id}/preview`, { method: "POST", body: JSON.stringify({ params }) });
export const revise = (id: string, params: unknown) => call<{ job_id: string }>(`/api/premium/projects/${id}/revise`, { method: "POST", body: JSON.stringify({ params }) });
export const quote = (product: PremiumId, minutes: number) =>
  call<{ intro: PremiumQuote | null; regular: PremiumQuote | null; introAvailable: boolean }>(`/api/premium/quote?product=${product}&minutes=${minutes.toFixed(2)}`);

export async function checkout(id: string, o: { product?: PremiumId; method: "brl" | "credits"; useIntro: boolean; cpf?: string }) {
  return call<{ order_id: string; paid: boolean; init_point: string | null; quote: PremiumQuote }>(`/api/premium/projects/${id}/checkout`, {
    method: "POST",
    body: JSON.stringify({ product: o.product, method: o.method, use_intro: o.useIntro, cpf: o.cpf, device_id: o.useIntro ? deviceId() : undefined, fingerprint: o.useIntro ? await browserFingerprint() : undefined }),
  });
}

export const shareToShowcase = (id: string, o: { genre: string; artist_name?: string; anonymous: boolean; title?: string }) =>
  call<{ item_id: string }>(`/api/premium/projects/${id}/showcase`, { method: "POST", body: JSON.stringify({ consent: true, ...o }) });
export const revokeShowcase = (itemId: string) => call<{ ok: true }>(`/api/premium/showcase/${itemId}`, { method: "DELETE" });

export const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
