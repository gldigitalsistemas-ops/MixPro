import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { exportServerConfigured, failResponse, unavailableResponse } from "@/lib/export/server-deps";
import type { Fail } from "@/lib/export/server-jobs";

export { failResponse, unavailableResponse, exportServerConfigured };

/** E-mail e confirmação da conta atual (para a trava da 1ª experiência). */
export async function currentEmail(): Promise<{ email: string | null; confirmed: boolean }> {
  const { data } = await (await supabaseServer()).auth.getUser();
  return { email: data.user?.email ?? null, confirmed: Boolean(data.user?.email_confirmed_at) };
}

export const isFail = (v: unknown): v is Fail => typeof v === "object" && v !== null && (v as Fail).ok === false;

/** Corpo JSON com teto de tamanho (pedidos premium são pequenos). */
export async function smallJson<T>(req: Request, max = 64_000): Promise<T | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  return (await req.json().catch(() => null)) as T | null;
}
