import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Dados de quem vende (Decreto 7.962/2013): editados no admin → Configurações → "empresa". */
export type Business = { nome: string; documento: string; endereco: string; email: string; whatsapp: string };

const EMPTY: Business = { nome: "", documento: "", endereco: "", email: "", whatsapp: "" };

export const getBusiness = cache(async (): Promise<Business> => {
  try {
    const { data } = await supabaseAdmin().from("system_settings").select("value").eq("key", "empresa").maybeSingle();
    const v = (data?.value ?? {}) as Partial<Business>;
    return {
      nome: String(v.nome ?? "").trim(),
      documento: String(v.documento ?? "").trim(),
      endereco: String(v.endereco ?? "").trim(),
      email: String(v.email ?? "").trim(),
      whatsapp: String(v.whatsapp ?? "").trim(),
    };
  } catch {
    return EMPTY;
  }
});

/** Link de WhatsApp a partir do número (só dígitos; sem DDI assume Brasil). */
export function whatsappLink(n: string): string | null {
  const digits = n.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
}
