/**
 * Envio das faixas da Mixagem Profissional direto pelo app: cada arquivo sobe do navegador ao R2
 * (URL assinada com o tamanho), em cofre/pro/<id>/ (guardado 30 dias pela regra do R2 para cofre/).
 * Um manifesto (dono, nomes e tamanhos) fica junto; a página de arquivos só abre para o dono e o admin.
 */
import { randomUUID } from "node:crypto";

export const PRO_MAX_FILES = 60;
export const PRO_MAX_FILE_BYTES = 2 * 1024 ** 3;
export const PRO_MAX_TOTAL_BYTES = 8 * 1024 ** 3;
const EXT = /\.(wav|aif|aiff|flac|mp3|m4a|ogg|zip|mid|midi|txt|pdf)$/i;
const ID_RE = /^[0-9a-f-]{36}$/;

export type ProFile = { key: string; name: string; bytes: number };
export type ProManifest = { user_id: string; created_at: string; files: ProFile[] };

export type ProObjects = {
  presign: (method: "GET" | "PUT", key: string, expiresS: number, opts?: { contentLength?: number; downloadName?: string }) => string;
  put: (key: string, data: Uint8Array) => Promise<void>;
  get: (key: string) => Promise<Uint8Array | null>;
};

const manifestKey = (id: string) => `cofre/pro/${id}/manifest.json`;

/** Nome seguro para mostrar e para o download (sem caminho, sem caracteres estranhos). */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const ext = (EXT.exec(base)?.[0] ?? "").toLowerCase();
  const stem = base
    .slice(0, base.length - ext.length)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${stem || "faixa"}${ext}`;
}

export async function createProUpload(
  objects: ProObjects,
  userId: string,
  files: unknown,
  id: string = randomUUID(),
): Promise<{ ok: true; id: string; uploads: string[] } | { ok: false; error: string }> {
  if (!Array.isArray(files) || !files.length) return { ok: false, error: "Escolha os arquivos das faixas." };
  if (files.length > PRO_MAX_FILES) return { ok: false, error: `Envie no máximo ${PRO_MAX_FILES} arquivos (ou junte em ZIP).` };
  const list: ProFile[] = [];
  let total = 0;
  for (const [i, f] of files.entries()) {
    const name = typeof f?.name === "string" ? f.name : "";
    const bytes = f?.bytes;
    if (!EXT.test(name)) return { ok: false, error: `“${name.slice(0, 40)}” não é um formato aceito (WAV, AIFF, FLAC, MP3, M4A, OGG, ZIP, MIDI).` };
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > PRO_MAX_FILE_BYTES) return { ok: false, error: `“${name.slice(0, 40)}” passa de 2 GB.` };
    total += bytes;
    const clean = safeName(name);
    list.push({ key: `cofre/pro/${id}/${String(i + 1).padStart(2, "0")}${clean.slice(clean.lastIndexOf(".")).toLowerCase()}`, name: clean, bytes });
  }
  if (total > PRO_MAX_TOTAL_BYTES) return { ok: false, error: "O total passa de 8 GB. Envie em ZIP ou por link." };
  const manifest: ProManifest = { user_id: userId, created_at: new Date().toISOString(), files: list };
  await objects.put(manifestKey(id), new TextEncoder().encode(JSON.stringify(manifest)));
  return { ok: true, id, uploads: list.map((f) => objects.presign("PUT", f.key, 3600, { contentLength: f.bytes })) };
}

/** Lista os arquivos para o dono ou o admin, com links de download de 1 hora. */
export async function proFiles(
  objects: ProObjects,
  id: string,
  viewer: { userId: string; admin: boolean },
): Promise<{ files: { name: string; bytes: number; url: string }[]; createdAt: string } | null> {
  if (!ID_RE.test(id)) return null;
  const raw = await objects.get(manifestKey(id));
  if (!raw) return null;
  const m = JSON.parse(new TextDecoder().decode(raw)) as ProManifest;
  if (m.user_id !== viewer.userId && !viewer.admin) return null;
  return {
    createdAt: m.created_at,
    files: m.files.map((f) => ({ name: f.name, bytes: f.bytes, url: objects.presign("GET", f.key, 3600, { downloadName: f.name.slice(-80) }) })),
  };
}
