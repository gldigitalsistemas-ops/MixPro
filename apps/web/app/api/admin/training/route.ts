import { randomUUID } from "node:crypto";
import { withAdmin } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/server";
import { R2Client, r2ConfigFromEnv } from "@/lib/export/r2";
import { TRAINING_GENRES, validTrainingFiles } from "@/lib/premium/training";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, max) : "");

/**
 * Mapa de treino (admin):
 *   POST { action: "create", genre, title, artist, source, rights_confirmed, rights_note, bpm, key, files: [{name, bytes, kind}] }
 *        → cria a música e devolve uma URL de envio por arquivo (treino/<id>/<nn>.<ext>, guardado sem prazo)
 *   POST { action: "status", id, status: "ready" | "rejected" | "pending" }
 *   POST { action: "delete", id }  → apaga a música e os arquivos
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  return withAdmin(async (adminId) => {
    const admin = supabaseAdmin();
    const r2 = new R2Client(r2ConfigFromEnv());
    const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
    if (body?.action === "create") {
      const genre = TRAINING_GENRES.find((g) => g.id === body.genre)?.id;
      const files = validTrainingFiles(body.files);
      const title = text(body.title, 120);
      if (!genre || !files || !title) return Response.json({ error: "Preencha gênero, título e envie pelo menos o mix (WAV, AIFF, FLAC, MP3 ou M4A)." }, { status: 400 });
      if (body.rights_confirmed !== true) return Response.json({ error: "Confirme que você tem os direitos ou a autorização por escrito." }, { status: 400 });
      const newId = randomUUID();
      const stored = files.map((f, i) => ({ key: `treino/${newId}/${String(i).padStart(2, "0")}.${f.name.split(".").pop()!.toLowerCase()}`, name: f.name, bytes: f.bytes, kind: f.kind }));
      const bpm = Number(body.bpm);
      const { error } = await admin.from("training_assets").insert({
        id: newId,
        genre,
        title,
        artist: text(body.artist, 120),
        source: body.source === "parceiro" ? "parceiro" : "proprio",
        rights_confirmed: true,
        rights_note: text(body.rights_note, 500),
        bpm: Number.isFinite(bpm) && bpm >= 30 && bpm <= 300 ? Math.round(bpm) : null,
        musical_key: text(body.key, 20) || null,
        files: stored,
        created_by: adminId,
      });
      if (error) return Response.json({ error: "Não foi possível salvar." }, { status: 500 });
      return Response.json({ id: newId, uploads: stored.map((f) => r2.presign("PUT", f.key, 3600, { contentLength: f.bytes })) });
    }
    if (body?.action === "status" && id && ["ready", "rejected", "pending"].includes(String(body.status))) {
      await admin.from("training_assets").update({ status: body.status }).eq("id", id);
      return Response.json({ ok: true });
    }
    if (body?.action === "delete" && id) {
      const { data } = await admin.from("training_assets").select("files").eq("id", id).maybeSingle();
      for (const f of ((data?.files ?? []) as { key: string }[])) await r2.delete(f.key).catch(() => {});
      await admin.from("training_assets").delete().eq("id", id);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  });
}
