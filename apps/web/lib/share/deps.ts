import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { R2Client, r2ConfigFromEnv } from "@/lib/export/r2";
import type { ShareDeps } from "./server";

/** Banco (service role) e R2 reais da página antes/depois. Sem R2 configurado: null. */
export function shareDeps(): ShareDeps | null {
  let r2: R2Client;
  try {
    r2 = new R2Client(r2ConfigFromEnv());
  } catch {
    return null;
  }
  const admin = supabaseAdmin();
  return {
    rpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error: error ? { message: error.message } : null };
    },
    presign: (method, key, expiresS, opts) => r2.presign(method, key, expiresS, opts),
  };
}
