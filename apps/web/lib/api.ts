import "server-only";
import { getSession, supabaseAdmin } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";

type Settings = Record<string, unknown>;

/** Garante usuário autenticado numa route handler. */
export async function withUser<T>(fn: (userId: string) => Promise<T>): Promise<T | Response> {
  const session = await getSession();
  if (!session) return jsonError(401, "Sua sessão expirou. Entre novamente.");
  if (session.profile && (session.profile as { blocked_at?: string | null }).blocked_at) {
    return jsonError(403, "Sua conta está temporariamente bloqueada.");
  }
  return fn(session.userId);
}

/** Garante usuário autenticado e com role=admin numa route handler. */
export async function withAdmin<T>(fn: (userId: string) => Promise<T>): Promise<T | Response> {
  const session = await getSession();
  if (!session) return jsonError(401, "Não autenticado.");
  if ((session.profile as { role?: string }).role !== "admin") return jsonError(403, "Acesso restrito.");
  return fn(session.userId);
}

export async function loadSettings(): Promise<Settings> {
  const { data } = await supabaseAdmin().from("system_settings").select("key,value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

export function num(settings: Settings, key: string, fallback: number): number {
  const v = Number(settings[key]);
  return Number.isFinite(v) ? v : fallback;
}
