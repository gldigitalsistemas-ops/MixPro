import { notFound } from "next/navigation";
import { requireSession, supabaseServer } from "@/lib/supabase/server";
import { getBalance, getPublicSetting } from "@/lib/queries";
import { Workspace, type HistoryJob, type WorkspaceData } from "./workspace";
import type { AudioFile, PresetCategory, ProcessingJob, Project, Track } from "@/lib/types";
import type { PresetChain } from "@mixpro/contracts";

export default async function ProjectPage(props: PageProps<"/app/projetos/[id]">) {
  const { id } = await props.params;
  const session = await requireSession(`/app/projetos/${id}`);
  const supabase = await supabaseServer();

  const { data: project } = await supabase.from("projects").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!project) notFound();

  const [{ data: tracks }, { data: categories }, { data: presets }, { data: favorites }, balance, allowed, maxMb] = await Promise.all([
    supabase.from("tracks").select("*").eq("project_id", id).order("position"),
    supabase.from("preset_categories").select("*").order("position"),
    supabase
      .from("presets")
      .select("id,name,description,style,category_id,image_url,active,position,version:preset_versions!presets_current_version_fk(id,chain)")
      .is("archived_at", null)
      .order("position"),
    supabase.from("favorites").select("preset_id"),
    getBalance(),
    getPublicSetting<string[]>("allowed_formats", ["wav", "mp3", "flac", "aiff", "aif"]),
    getPublicSetting<number>("max_upload_mb", 50),
  ]);

  const track = (tracks ?? [])[0] as Track | undefined;
  if (!track) notFound();

  const [{ data: source }, { data: jobs }] = await Promise.all([
    track.source_file_id
      ? supabase.from("audio_files").select("*").eq("id", track.source_file_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("processing_jobs")
      .select("*, preset_version:preset_versions(version, preset:presets!preset_versions_preset_id_fkey(name))")
      .eq("track_id", track.id)
      .in("type", ["preview", "render"])
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const { data: analyzeJob } = source
    ? await supabase
        .from("processing_jobs")
        .select("*")
        .eq("source_file_id", source.id)
        .eq("type", "analyze")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  type PresetRow = {
    id: string;
    name: string;
    description: string | null;
    style: string | null;
    category_id: string;
    image_url: string | null;
    active: boolean;
    version: { id: string; chain: PresetChain } | null;
  };

  const data: WorkspaceData = {
    project: project as Project,
    track,
    source: (source as AudioFile) ?? null,
    analyzeJob: (analyzeJob as ProcessingJob) ?? null,
    categories: (categories ?? []) as PresetCategory[],
    presets: ((presets ?? []) as unknown as PresetRow[])
      .filter((p) => p.version && (p.version.chain?.chain?.length ?? 0) > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        style: p.style,
        category_id: p.category_id,
        image_url: p.image_url,
        active: p.active,
        version_id: p.version!.id,
        chain: p.version!.chain,
      })),
    favorites: (favorites ?? []).map((f) => f.preset_id as string),
    history: (jobs ?? []) as HistoryJob[],
    balance,
    uploadLimits: { allowed, maxMb: Number(maxMb) },
    isAdmin: session.profile.role === "admin",
  };

  return <Workspace data={data} />;
}
