import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { presignDownload } from "@/lib/storage";
import { jsonError } from "@/lib/errors";
import { withUser } from "@/lib/api";
import type { AudioFile } from "@/lib/types";

type Playable = {
  id: string;
  url: string;
  peaks: number[] | null;
  lufs: number | null;
  duration_s: number | null;
  analysis: AudioFile["analysis"];
};

async function readPeaks(key: string | null): Promise<number[] | null> {
  if (!key) return null;
  try {
    const r = await fetch(await presignDownload(key, { expiresIn: 60 }), { cache: "no-store" });
    if (!r.ok) return null;
    return ((await r.json()) as { peaks: number[] }).peaks;
  } catch {
    return null;
  }
}

async function playable(f: AudioFile & { storage_key: string }): Promise<Playable> {
  const [url, peaks] = await Promise.all([presignDownload(f.storage_key, { expiresIn: 3600 }), readPeaks(f.peaks_key)]);
  return { id: f.id, url, peaks, lufs: f.analysis?.lufs_integrated ?? null, duration_s: f.duration_s, analysis: f.analysis };
}

/**
 * URL de reprodução (assinada, 1h) + picos da waveform de um arquivo do usuário.
 * Para previews, inclui também o trecho original equivalente (A/B).
 * Arquivos finais (render) NÃO são servidos aqui — só via /api/downloads (cobrança).
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  return withUser(async () => {
    const supabase = await supabaseServer();
    const { data: file } = await supabase
      .from("audio_files")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!file) return jsonError(404, "Arquivo não encontrado ou expirado.");
    if (!["source", "segment", "preview"].includes(file.kind)) return jsonError(403, "Arquivo indisponível para reprodução.");
    if (file.status !== "ready") return jsonError(409, "O arquivo ainda não está pronto.");

    // Atualiza último acesso (retenção) sem bloquear a resposta
    void supabaseAdmin().from("audio_files").update({ last_accessed_at: new Date().toISOString() }).eq("id", id);

    if (file.kind === "source") {
      // Original completo: só os picos (a reprodução usa os trechos em FLAC)
      return Response.json({ id: file.id, peaks: await readPeaks(file.peaks_key), duration_s: file.duration_s });
    }

    const self = await playable(file);
    let pair: Playable | null = null;
    if (file.original_pair_id) {
      const { data: p } = await supabase.from("audio_files").select("*").eq("id", file.original_pair_id).is("deleted_at", null).maybeSingle();
      if (p && p.status === "ready") pair = await playable(p);
    }
    return Response.json({ ...self, pair });
  });
}
