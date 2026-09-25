import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/public-env";
import { serverEnv } from "@/lib/env";
import type { Profile } from "@/lib/types";

/** Cliente com a sessão do usuário (RLS aplicada). */
export async function supabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Chamado de um Server Component: o proxy renova a sessão.
        }
      },
    },
  });
}

/** Cliente com service role — ignora RLS. Use apenas após validar o usuário. */
export function supabaseAdmin(): SupabaseClient {
  return createClient(publicEnv.supabaseUrl, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Session = { userId: string; email: string | null; profile: Profile };

/** Usuário atual validado no Auth (não confia apenas no cookie). */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single();
  if (!profile) return null;
  return { userId: data.user.id, email: data.user.email ?? null, profile: profile as Profile };
});

export async function requireSession(next?: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`/entrar${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession("/admin");
  if (session.profile.role !== "admin") redirect("/app");
  return session;
}
