import type { PresetChain } from "@mixpro/contracts";

export type UserRole = "user" | "admin";
export type ProjectMode = "single" | "stereo" | "multitrack";
export type AudioType = "vocal" | "drums" | "guitar" | "acoustic" | "piano" | "bass" | "mix" | "master" | "other";
export type FileKind = "source" | "proxy" | "segment" | "preview" | "render" | "mix" | "reference" | "order_file" | "delivery";
export type FileStatus = "uploading" | "uploaded" | "analyzing" | "ready" | "invalid" | "deleted";
export type JobType = "analyze" | "preview" | "render" | "mix_preview" | "mix_render";
export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  referral_code: string;
  referred_by: string | null;
  onboarded_at: string | null;
  created_at: string;
};

export type Project = {
  id: string;
  user_id: string;
  name: string;
  mode: ProjectMode;
  audio_type: AudioType;
  last_processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AnalysisStats = {
  peak_dbfs: number | null;
  true_peak_dbtp: number | null;
  rms_dbfs: number | null;
  lufs_integrated: number | null;
  dynamic_range_db: number | null;
  clipping_runs: number;
  silent: boolean;
  thumb?: number[];
  suggested_preview_start?: number;
};

export type AudioFile = {
  id: string;
  user_id: string;
  project_id: string | null;
  kind: FileKind;
  status: FileStatus;
  original_name: string | null;
  ext: string | null;
  size_bytes: number | null;
  duration_s: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  codec: string | null;
  peaks_key: string | null;
  analysis: AnalysisStats | null;
  warnings: string[];
  error_message: string | null;
  original_pair_id: string | null;
  created_at: string;
};

export type Track = {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  position: number;
  category_id: string | null;
  source_file_id: string | null;
  preset_version_id: string | null;
  intensity: 25 | 50 | 75 | 100;
  volume_db: number;
  pan: number;
  muted: boolean;
  solo: boolean;
};

export type PresetCategory = {
  id: string;
  group_id: string;
  name: string;
  audio_types: AudioType[];
  icon: string | null;
  position: number;
};

export type Preset = {
  id: string;
  slug: string;
  name: string;
  category_id: string;
  style: string | null;
  description: string | null;
  tags: string[];
  image_url: string | null;
  active: boolean;
  current_version_id: string | null;
  position: number;
  archived_at: string | null;
};

export type PresetVersion = {
  id: string;
  preset_id: string;
  version: number;
  chain: PresetChain;
  default_intensity: 25 | 50 | 75 | 100;
  notes: string | null;
  created_at: string;
};

export type ProcessingJob = {
  id: string;
  user_id: string;
  project_id: string | null;
  track_id: string | null;
  type: JobType;
  status: JobStatus;
  source_file_id: string | null;
  preset_version_id: string | null;
  intensity: number | null;
  params: { start_s?: number; duration_s?: number; format?: string; download_key?: string };
  cache_hit: boolean;
  progress: number;
  stage: string | null;
  output_file_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export const AUDIO_TYPE_LABEL: Record<AudioType, string> = {
  vocal: "Voz",
  drums: "Bateria",
  guitar: "Guitarra",
  acoustic: "Violão",
  piano: "Piano",
  bass: "Baixo",
  mix: "Mix",
  master: "Master",
  other: "Outro",
};

/** Categoria de preset padrão para cada tipo de áudio (modo faixa única). */
export const DEFAULT_CATEGORY: Record<AudioType, string> = {
  vocal: "vocal",
  drums: "drum_bus",
  guitar: "guitar",
  acoustic: "acoustic",
  piano: "piano",
  bass: "bass",
  mix: "master",
  master: "master",
  other: "master",
};

export const WARNING_LABEL: Record<string, string> = {
  clipping: "O áudio original tem trechos com clipping (distorção digital). O resultado pode herdar essa distorção.",
  low_level: "O volume da gravação está muito baixo.",
  low_sample_rate: "Taxa de amostragem abaixo de 44,1 kHz — a qualidade pode ser limitada.",
  downmixed_to_stereo: "O arquivo tinha mais de 2 canais e foi convertido para estéreo.",
  output_clipping: "O resultado ultrapassa 0 dBFS em alguns pontos.",
};
