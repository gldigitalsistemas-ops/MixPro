import { requireSession, supabaseAdmin } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { StemSeparatorForm } from "./stem-form";

export const metadata = { title: "Separar Stems" };

export default async function StemSeparatePage() {
  const session = await requireSession("/app/lab/separar");
  const admin = supabaseAdmin();

  const { data: setting } = await admin.from("system_settings").select("value").eq("key", "ai_lab_stem_enabled").single();
  if (!setting?.value) redirect("/app/lab");

  // Busca arquivos de áudio prontos do usuário (renders e sources)
  const { data: files } = await admin
    .from("audio_files")
    .select("id,original_name,kind,size_bytes,created_at")
    .eq("user_id", session.userId)
    .in("status", ["ready"])
    .in("kind", ["source", "render"])
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Separação de Stems</h1>
        <p className="mt-1 text-sm text-muted">
          Escolha um arquivo de áudio e deixe a IA separar os instrumentos em arquivos individuais.
        </p>
      </div>
      <StemSeparatorForm files={files ?? []} />
    </div>
  );
}
