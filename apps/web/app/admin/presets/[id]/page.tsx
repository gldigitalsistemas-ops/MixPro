import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PresetEditor, type EditorPreset } from "./editor";
import type { PresetCategory, PresetVersion } from "@/lib/types";

export default async function EditPresetPage(props: PageProps<"/admin/presets/[id]">) {
  const { id } = await props.params;
  const supabase = await supabaseServer();
  const { data: categories } = await supabase.from("preset_categories").select("*").order("position");

  if (id === "novo") {
    return <PresetEditor preset={null} versions={[]} categories={(categories ?? []) as PresetCategory[]} usage={0} />;
  }

  const { data: preset } = await supabase.from("presets").select("*").eq("id", id).maybeSingle();
  if (!preset) notFound();
  const { data: versions } = await supabase.from("preset_versions").select("*").eq("preset_id", id).order("version", { ascending: false });
  const versionIds = (versions ?? []).map((v) => v.id);
  const { count } = versionIds.length
    ? await supabase.from("processing_jobs").select("id", { count: "exact", head: true }).in("preset_version_id", versionIds)
    : { count: 0 };

  return (
    <PresetEditor
      preset={preset as EditorPreset}
      versions={(versions ?? []) as PresetVersion[]}
      categories={(categories ?? []) as PresetCategory[]}
      usage={count ?? 0}
    />
  );
}
