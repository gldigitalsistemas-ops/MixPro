import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

export async function getBalance(): Promise<number> {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("my_credit_balance", { p_kind: "download" });
  return typeof data === "number" ? data : 0;
}

export async function getPublicSetting<T>(key: string, fallback: T): Promise<T> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("system_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
