import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { ProjectSummary } from "@/components/projects/project-card";
import type { AudioType } from "@/lib/types";

type Row = {
  id: string;
  name: string;
  audio_type: AudioType;
  created_at: string;
  last_processed_at: string | null;
  tracks: { position: number; source: { status: string; duration_s: number | null; analysis: { thumb?: number[] } | null } | null }[];
};

export async function listProjects(limit = 50): Promise<ProjectSummary[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("projects")
    .select(
      "id,name,audio_type,created_at,last_processed_at,tracks(position,source:audio_files!tracks_source_file_id_fkey(status,duration_s,analysis))",
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as unknown as Row[]).map((p) => {
    const first = [...p.tracks].sort((a, b) => a.position - b.position)[0];
    return {
      id: p.id,
      name: p.name,
      audio_type: p.audio_type,
      created_at: p.created_at,
      last_processed_at: p.last_processed_at,
      track_count: p.tracks.length,
      duration_s: first?.source?.duration_s ?? null,
      file_status: first?.source?.status ?? null,
      thumb: first?.source?.analysis?.thumb ?? null,
    };
  });
}
