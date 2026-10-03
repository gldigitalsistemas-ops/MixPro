/**
 * buildExportJob: estado da edição → ExportJob validado. Função pura (sem React nem DOM).
 *
 * A cadeia é montada com as MESMAS funções da prévia do estúdio, na mesma ordem:
 * withDrumTweaks → withReverb → withMaster (que congela o master com freezeChain na intensidade
 * padrão dele). A intensidade da mixagem NÃO é congelada aqui: vai à parte, como hoje no runDsp.
 */
import { exportJobSchema, type ExportJob, type ExportTarget } from "@mixpro/contracts";
import type { ChainDoc } from "@/lib/dsp/chain";
import { isBuiltinCab } from "@/lib/dsp/cab-ir";
import type { Signal } from "@/lib/dsp/types";
import { DSP_VERSION } from "@/lib/dsp/version";
import type { CabIR, DrumLibraryItem } from "@/lib/drums/library";
import { SLOT_PARAM, withDrumTweaks, type DrumTweaks } from "@/lib/drums/tweaks";
import { signalFingerprint } from "@/lib/hash";
import { needsRender, type AudiogramStyle, type Look } from "@/lib/media/compose";
import type { CutLevel, Segment } from "@/lib/media/cuts";
import type { MusicLevel } from "@/lib/media/music";
import { withMaster } from "@/lib/mix";
import type { StudioPreset } from "@/lib/presets";
import { withReverb, type ReverbTweak } from "@/lib/reverb-tweak";
import { audioRef, editRef, fileKey, resultRef, settingsRef, type FileLike } from "./refs";

/** Partes da cadeia, como o estúdio as guarda. */
export type ChainParts = {
  /** Cadeia do preset ou a personalizada (já congelada). */
  base: ChainDoc;
  drums: DrumTweaks | null;
  reverb: ReverbTweak | null;
  master: StudioPreset | null;
};

/** Cadeia final da mixagem: a mesma da prévia do estúdio. */
export function composeChain(p: ChainParts): ChainDoc {
  return withMaster(withReverb(withDrumTweaks(p.base, p.drums), p.reverb), p.master);
}

export type ExportState = {
  target: ExportTarget;
  media: {
    file: FileLike;
    kind: "video" | "audio";
    videoContainer: "mp4" | "webm";
    sampleRate: number;
    channels: Signal;
    audioStart: number;
    duration: number;
  };
  preset: Pick<StudioPreset, "slug" | "versionId" | "userPresetId">;
  chainParts: ChainParts;
  /** A cadeia base é a personalizada (valores congelados). */
  customizing: boolean;
  /** A que vai para o runChain (100 quando personalizando). */
  intensity: number;
  denoise: number;
  social: boolean;
  cutLevel: CutLevel;
  segments: Segment[];
  cutting: boolean;
  look: Look;
  comparing: boolean;
  audiogram: AudiogramStyle | null;
  music: { name: string; level: MusicLevel; channels: Signal } | null;
  /** Catálogo de samples e IRs enviados (para referenciar os arquivos usados). */
  library: { drums: Pick<DrumLibraryItem, "id" | "files" | "room_files">[]; irs: Pick<CabIR, "id" | "file">[] };
  buildId: string;
};

/** O job não passou na validação. A mensagem leva só os caminhos dos campos, nunca os valores. */
export class ExportJobError extends Error {
  constructor(public paths: string[]) {
    super(`ExportJob inválido: ${paths.join(", ")}`);
    this.name = "ExportJobError";
  }
}

const SAMPLE_PARAMS = Object.values(SLOT_PARAM);

/** Samples e IRs que a cadeia usa, com os arquivos do Storage (o caminho identifica o conteúdo). */
function assetsOf(chain: ChainDoc, library: ExportState["library"]): ExportJob["audio"]["assets"] {
  const active = chain.chain.filter((m) => !m.bypass);
  const drumIds = new Set<string>();
  for (const m of active.filter((m) => m.type === "drum_studio"))
    for (const k of SAMPLE_PARAMS) {
      const id = m.params?.[k];
      if (typeof id === "string" && id) drumIds.add(id);
    }
  const irIds = new Set<string>();
  for (const m of active.filter((m) => m.type === "amp")) {
    const id = m.params?.ir;
    if (typeof id === "string" && id) irIds.add(id);
  }
  return {
    drum_samples: [...drumIds].sort().map((id) => {
      const item = library.drums.find((s) => s.id === id);
      return { id, builtin: !item, files: item ? [...item.files] : [], room_files: item ? [...(item.room_files ?? [])] : [] };
    }),
    irs: [...irIds].sort().map((id) => {
      const item = library.irs.find((x) => x.id === id);
      return { id, builtin: isBuiltinCab(id) || !item, file: item?.file ?? null };
    }),
  };
}

export function buildExportJob(s: ExportState): ExportJob {
  const { media, look } = s;
  const chain = composeChain(s.chainParts);
  const audio = audioRef({ file: media.file, presetSlug: s.preset.slug, intensity: s.intensity, social: s.social, denoise: s.denoise, chain });
  const edit = editRef({ cutting: s.cutting, segments: s.segments, look, audiogram: s.audiogram, music: s.music, comparing: s.comparing });
  const video = s.target === "video";
  const render = video && (media.kind === "audio" || s.comparing || needsRender(look, s.cutting));
  const color = look.color;
  const master = s.chainParts.master;

  const job: ExportJob = {
    schema_version: 1,
    kind: video ? "video" : "audio",
    engine: { dsp_version: DSP_VERSION, build_id: s.buildId },
    source: {
      media: media.kind,
      container: media.videoContainer,
      duration_s: media.duration,
      sample_rate: media.sampleRate,
      channels: media.channels.length,
      audio_start_s: media.audioStart,
      file_ref: fileKey(media.file),
      content_fingerprint: signalFingerprint(media.channels),
    },
    audio: {
      preset: {
        slug: s.preset.slug,
        version_id: s.preset.versionId ?? null,
        custom: s.customizing,
        user_preset_id: s.preset.userPresetId ?? null,
      },
      chain: chain as ExportJob["audio"]["chain"],
      intensity: s.intensity as ExportJob["audio"]["intensity"],
      master: master ? { slug: master.slug, version_id: master.versionId ?? null } : null,
      denoise: s.denoise,
      social: { enabled: s.social, target_lufs: -14, ceiling_db: -1 },
      assets: assetsOf(chain, s.library),
      music: s.music ? { fingerprint: signalFingerprint(s.music.channels), level: s.music.level, upload_ref: null } : null,
      audio_ref: audio,
    },
    cuts: { applied: s.cutting, level: s.cutLevel, segments: s.segments.map((x) => ({ start: x.start, end: x.end })) },
    captions: look.captions
      ? { captions: look.captions.captions, style: look.captions.style, position: look.captions.position }
      : null,
    look: {
      format: look.format,
      fit: look.fit,
      watermark: look.watermark,
      font_family: look.fontFamily,
      color: color
        ? {
            auto: color.auto,
            correction: color.correction
              ? {
                  exposure: color.correction.exposure,
                  contrast: color.correction.contrast,
                  saturation: color.correction.saturation,
                  wb: [...color.correction.wb],
                  notes: [...color.correction.notes],
                }
              : null,
            filter: color.filter,
            amount: color.amount,
            sharpen: color.sharpen,
            vignette: color.vignette,
          }
        : null,
      cta: look.cta ? { text: look.cta.text, handle: look.cta.handle, start: look.cta.start, end: look.cta.end } : null,
      before_after: s.comparing,
      audiogram: s.audiogram
        ? { palette: s.audiogram.palette, title: s.audiogram.title, has_image: Boolean(s.audiogram.image), upload_ref: null }
        : null,
    },
    output: { target: s.target, container: video ? (render ? "mp4" : media.videoContainer) : null, render, quality: "high" },
    idempotency_ref: resultRef(settingsRef(audio, edit), s.target),
  };

  const r = exportJobSchema.safeParse(job);
  if (!r.success) throw new ExportJobError([...new Set(r.error.issues.map((i) => i.path.join(".") || "(raiz)"))]);
  return job;
}
