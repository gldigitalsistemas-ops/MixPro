import { Suspense } from "react";
import { SignupForm } from "@/components/auth/auth-form";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Criar conta" };

export default async function Page() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("system_settings").select("value").eq("key", "free_downloads").maybeSingle();
  return (
    <Suspense>
      <SignupForm freeDownloads={Number(data?.value ?? 5)} />
    </Suspense>
  );
}
