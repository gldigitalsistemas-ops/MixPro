import "server-only";
import { randomUUID } from "node:crypto";
import { idFromToken } from "./identity";
import { supabaseAdmin } from "@/lib/supabase/server";
import { R2Client, r2ConfigFromEnv } from "@/lib/export/r2";
import { MIX_GENRES } from "@mixpro/contracts";

/**
 * Vitrine: trechos de 30 s (antes/depois) de produções reais, só com consentimento (opt-in, revogável)
 * e aprovação do admin. Arquivos em vitrine/<id>/ (prefixo sem limpeza automática no R2).
 */
export const CONSENT_VERSION = "v1-2026-10";
export const SHOWCASE_PRODUCTS = ["estudio", "vs_premium", "mix_ia", "producao", "voz_final"] as const;

const r2 = () => new R2Client(r2ConfigFromEnv());

/** Nomes das prévias que o serviço grava junto com cada entrega premium. */
export const CLIP_BEFORE = "vitrine-antes.m4a";
export const CLIP_AFTER = "vitrine-depois.m4a";

const cleanText = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, max) : "");

async function copy(from: string, to: string) {
  const c = r2();
  const chunks: Buffer[] = [];
  for await (const x of c.read(from)) chunks.push(x as Buffer);
  await c.put(to, new Uint8Array(Buffer.concat(chunks)));
}

export type ShareInput = { consent?: unknown; genre?: unknown; artist_name?: unknown; anonymous?: unknown; title?: unknown };

/** A pessoa autoriza o trecho da produção entregue (não é condição para baixar). */
export async function shareProject(userId: string, projectId: string, input: ShareInput): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  if (input.consent !== true) return { ok: false, status: 400, error: "É preciso marcar a autorização." };
  const admin = supabaseAdmin();
  const { data: p } = await admin.from("premium_projects").select("id,user_id,product,final_job,title").eq("id", projectId).maybeSingle();
  if (!p || p.user_id !== userId || !p.final_job) return { ok: false, status: 404, error: "Produção não encontrada." };
  const { data: job } = await admin.from("tool_jobs").select("status,outputs").eq("id", p.final_job).maybeSingle();
  const outs = (job?.outputs ?? []) as { key: string; name: string }[];
  const before = outs.find((o) => o.name === CLIP_BEFORE);
  const after = outs.find((o) => o.name === CLIP_AFTER);
  if (job?.status !== "done" || !after) return { ok: false, status: 409, error: "A produção ainda não está pronta." };
  const { data: existing } = await admin.from("showcase_items").select("id").eq("project_id", projectId).neq("status", "revoked").maybeSingle();
  if (existing) return { ok: true, id: existing.id as string };
  const id = randomUUID();
  const beforeKey = before ? `vitrine/${id}/antes.m4a` : null;
  const afterKey = `vitrine/${id}/depois.m4a`;
  if (before) await copy(before.key, beforeKey!);
  await copy(after.key, afterKey);
  const genre = (MIX_GENRES as readonly string[]).includes(String(input.genre)) ? String(input.genre) : "";
  const anonymous = input.anonymous !== false;
  const { error } = await admin.from("showcase_items").insert({
    id,
    user_id: userId,
    project_id: projectId,
    product: p.product,
    genre,
    title: cleanText(input.title, 80) || (p.title as string).replace(/\.[^.]+$/, "").slice(0, 80),
    artist_name: anonymous ? null : cleanText(input.artist_name, 60) || null,
    anonymous,
    before_key: beforeKey,
    after_key: afterKey,
    consent_version: CONSENT_VERSION,
    consent_at: new Date().toISOString(),
  });
  if (error) return { ok: false, status: 500, error: "Não foi possível registrar agora." };
  return { ok: true, id };
}

/** O dono retira a autorização: sai do ar e os arquivos são apagados. */
export async function revokeItem(userId: string, itemId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("revoke_showcase_item", { p_item: itemId, p_user: userId });
  if (error || typeof data !== "string") return false;
  const c = r2();
  for (const k of data.split("|").filter(Boolean)) await c.delete(k).catch(() => {});
  return true;
}

export type PublicItem = { id: string; product: string; genre: string; title: string; artist: string | null; before: string | null; after: string; featured: boolean };

/** Itens aprovados para a vitrine pública (URLs de 1 h). */
export async function publicItems(o: { product?: string | null; genre?: string | null; limit?: number } = {}): Promise<PublicItem[]> {
  let q = supabaseAdmin()
    .from("showcase_items")
    .select("id,product,genre,title,artist_name,anonymous,before_key,after_key,featured")
    .eq("status", "approved")
    .order("featured", { ascending: false })
    .order("position")
    .order("created_at", { ascending: false })
    .limit(Math.min(48, o.limit ?? 24));
  if (o.product && (SHOWCASE_PRODUCTS as readonly string[]).includes(o.product)) q = q.eq("product", o.product);
  if (o.genre && (MIX_GENRES as readonly string[]).includes(o.genre)) q = q.eq("genre", o.genre);
  const { data, error } = await q;
  if (error || !data) return [];
  let c: R2Client;
  try {
    c = r2();
  } catch {
    return [];
  }
  return data.map((r) => ({
    id: r.id as string,
    product: r.product as string,
    genre: r.genre as string,
    title: r.title as string,
    artist: r.anonymous ? null : ((r.artist_name as string | null) ?? null),
    before: r.before_key ? c.presign("GET", r.before_key as string, 3600) : null,
    after: c.presign("GET", r.after_key as string, 3600),
    featured: Boolean(r.featured),
  }));
}

/** Admin: exemplo próprio (já aprovado) — devolve URLs para enviar os dois trechos. */
export async function adminCreate(adminId: string, input: { product?: unknown; genre?: unknown; title?: unknown; artist_name?: unknown; before_bytes?: unknown; after_bytes?: unknown; ext?: unknown }) {
  const product = (SHOWCASE_PRODUCTS as readonly string[]).includes(String(input.product)) ? String(input.product) : null;
  const ext = ["m4a", "mp3", "wav"].includes(String(input.ext)) ? String(input.ext) : null;
  const aBytes = Number(input.after_bytes);
  const bBytes = Number(input.before_bytes);
  if (!product || !ext || !Number.isInteger(aBytes) || aBytes < 1 || aBytes > 20e6 || (input.before_bytes != null && (!Number.isInteger(bBytes) || bBytes < 1 || bBytes > 20e6))) {
    return { ok: false as const, error: "Dados inválidos (trechos de até 20 MB, M4A, MP3 ou WAV)." };
  }
  const id = randomUUID();
  const beforeKey = input.before_bytes != null ? `vitrine/${id}/antes.${ext}` : null;
  const afterKey = `vitrine/${id}/depois.${ext}`;
  const artist = cleanText(input.artist_name, 60);
  const { error } = await supabaseAdmin().from("showcase_items").insert({
    id,
    user_id: null,
    product,
    genre: (MIX_GENRES as readonly string[]).includes(String(input.genre)) ? String(input.genre) : "",
    title: cleanText(input.title, 80),
    artist_name: artist || null,
    anonymous: !artist,
    before_key: beforeKey,
    after_key: afterKey,
    status: "approved",
    consent_version: `admin:${adminId.slice(0, 8)}`,
    consent_at: new Date().toISOString(),
    reviewed_at: new Date().toISOString(),
  });
  if (error) return { ok: false as const, error: "Não foi possível criar." };
  const c = r2();
  return {
    ok: true as const,
    id,
    uploads: { after: c.presign("PUT", afterKey, 3600, { contentLength: aBytes }), before: beforeKey ? c.presign("PUT", beforeKey, 3600, { contentLength: bBytes }) : null },
  };
}

/** Estúdio: a pessoa autoriza na vitrine o antes e depois que acabou de compartilhar (link de 24 h). */
export async function shareStudio(userId: string, input: ShareInput & { token?: unknown }): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  if (input.consent !== true) return { ok: false, status: 400, error: "É preciso marcar a autorização." };
  const token = typeof input.token === "string" && /^[A-Za-z0-9_-]{16,32}$/.test(input.token) ? input.token : null;
  if (!token) return { ok: false, status: 400, error: "Link inválido." };
  const admin = supabaseAdmin();
  const { data: link } = await admin.from("share_links").select("user_id,ext,expires_at,preset").eq("token", token).maybeSingle();
  if (!link || link.user_id !== userId || new Date(link.expires_at as string).getTime() < Date.now()) return { ok: false, status: 404, error: "O link de antes e depois já expirou. Crie outro e autorize em seguida." };
  const id = idFromToken(token);
  const { data: existing } = await admin.from("showcase_items").select("id,status").eq("id", id).maybeSingle();
  if (existing && existing.status !== "revoked") return { ok: true, id };
  const ext = link.ext as string;
  await copy(`out/share/${token}/a.${ext}`, `vitrine/${id}/antes.${ext}`);
  await copy(`out/share/${token}/b.${ext}`, `vitrine/${id}/depois.${ext}`);
  const genre = (MIX_GENRES as readonly string[]).includes(String(input.genre)) ? String(input.genre) : "";
  const anonymous = input.anonymous !== false;
  const row = {
    id,
    user_id: userId,
    project_id: null,
    product: "estudio",
    genre,
    title: cleanText(input.title, 80) || (link.preset as string) || "Tratamento no Estúdio",
    artist_name: anonymous ? null : cleanText(input.artist_name, 60) || null,
    anonymous,
    before_key: `vitrine/${id}/antes.${ext}`,
    after_key: `vitrine/${id}/depois.${ext}`,
    status: "pending",
    consent_version: CONSENT_VERSION,
    consent_at: new Date().toISOString(),
    rewarded_at: null,
    revoked_at: null,
  };
  const { error } = existing ? await admin.from("showcase_items").update(row).eq("id", id) : await admin.from("showcase_items").insert(row);
  if (error) return { ok: false, status: 500, error: "Não foi possível registrar agora." };
  return { ok: true, id };
}
