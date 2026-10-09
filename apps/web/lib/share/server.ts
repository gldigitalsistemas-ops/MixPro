/**
 * Página antes/depois compartilhável: o usuário envia dois trechos curtos (antes e depois) direto ao R2
 * e recebe um link público que vale 24 h. Os arquivos ficam em out/share/<token>/ (a regra de 1 dia
 * do R2 para out/ apaga sozinha); o banco guarda só título, preset e loudness.
 */
import { randomBytes } from "node:crypto";

export const SHARE_MAX_BYTES = 8 * 1024 * 1024;
export const SHARE_EXTS = ["m4a", "wav"] as const;
export type ShareExt = (typeof SHARE_EXTS)[number];

export type ShareDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  presign: (method: "GET" | "PUT", key: string, expiresS: number, opts?: { contentLength?: number }) => string;
  token?: () => string;
};

export type ShareInput = { title?: unknown; preset?: unknown; ext?: unknown; bytes?: unknown; lufs_before?: unknown; lufs_after?: unknown };

export const shareKey = (token: string, side: "a" | "b", ext: ShareExt) => `out/share/${token}/${side}.${ext}`;
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,32}$/;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const lufs = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > -90 && v < 10 ? Math.round(v * 10) / 10 : null);

export async function createShare(
  deps: ShareDeps,
  userId: string,
  input: ShareInput,
): Promise<{ ok: true; token: string; uploads: { a: string; b: string } } | { ok: false; status: number; error: string }> {
  const ext = SHARE_EXTS.includes(input.ext as ShareExt) ? (input.ext as ShareExt) : null;
  const bytes = Array.isArray(input.bytes) ? input.bytes : [];
  if (!ext || bytes.length !== 2 || !bytes.every((b) => Number.isInteger(b) && b > 0 && b <= SHARE_MAX_BYTES))
    return { ok: false, status: 400, error: "Trecho inválido para compartilhar." };
  const token = deps.token?.() ?? randomBytes(18).toString("base64url");
  const { error } = await deps.rpc("create_share_link", {
    p_user: userId,
    p_token: token,
    p_title: text(input.title, 80),
    p_preset: text(input.preset, 60),
    p_ext: ext,
    p_lufs_before: lufs(input.lufs_before),
    p_lufs_after: lufs(input.lufs_after),
  });
  if (error) {
    if (error.message.includes("LIMIT")) return { ok: false, status: 429, error: "Você já criou muitos links hoje. Tente de novo amanhã." };
    return { ok: false, status: 500, error: "Não foi possível criar o link agora. Tente de novo." };
  }
  return {
    ok: true,
    token,
    uploads: {
      a: deps.presign("PUT", shareKey(token, "a", ext), 600, { contentLength: bytes[0] as number }),
      b: deps.presign("PUT", shareKey(token, "b", ext), 600, { contentLength: bytes[1] as number }),
    },
  };
}

export type SharePage = {
  title: string;
  preset: string;
  lufsBefore: number | null;
  lufsAfter: number | null;
  expiresAt: string;
  referralCode: string | null;
  before: string;
  after: string;
};

/** Abre a página pública (conta a visita). Expirada ou inexistente: null. */
export async function openShare(deps: ShareDeps, token: string): Promise<SharePage | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data, error } = await deps.rpc("open_share_link", { p_token: token });
  const row = !error && Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  const ext = row.ext as ShareExt;
  return {
    title: String(row.title ?? ""),
    preset: String(row.preset ?? ""),
    lufsBefore: (row.lufs_before as number | null) ?? null,
    lufsAfter: (row.lufs_after as number | null) ?? null,
    expiresAt: String(row.expires_at),
    referralCode: (row.referral_code as string | null) ?? null,
    before: deps.presign("GET", shareKey(token, "a", ext), 3600),
    after: deps.presign("GET", shareKey(token, "b", ext), 3600),
  };
}
