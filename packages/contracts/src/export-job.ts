import { z } from "zod";
import { chainModuleSchema } from "./chain";

/**
 * Cadeia do job: os mesmos módulos validados do preset, mas com mais espaço, porque a cadeia combinada
 * soma a mixagem (até 32 no editor) e o master.
 */
export const jobChainSchema = z.object({ schema_version: z.literal(1), chain: z.array(chainModuleSchema).max(80) }).strict();

/**
 * ExportJob: o "pedido de exportação" como dado puro, versionado e serializável em JSON.
 * Tudo o que define o arquivo final está aqui; os dados pesados (áudio do arquivo, música,
 * imagem do audiograma, samples e IRs já decodificados) ficam fora e são referenciados.
 *
 * NUNCA registre um ExportJob em logs, eventos ou console: ele contém a fala transcrita (legendas)
 * e o texto do CTA do usuário.
 */

/** Tempo em segundos do original (pode ser negativo: audio_start de alguns MP4). */
const seconds = z.number().finite();
/** Limites folgados: a interface não limita o texto do CTA nem a edição das legendas. */
const shortText = (max: number) => z.string().max(max);

const segmentSchema = z.object({ start: seconds, end: seconds }).strict();

const wordSchema = z.object({ text: shortText(10_000), start: seconds, end: seconds }).strict();
const captionSchema = z.object({ start: seconds, end: seconds, words: z.array(wordSchema).max(5000) }).strict();

export const CAPTION_STYLE_IDS = ["destaque", "classica", "caixa", "karaoke", "marca", "neon", "emoji"] as const;
export const CAPTION_POSITIONS = ["top", "middle", "bottom"] as const;
export const VIDEO_FORMATS = ["original", "9:16", "1:1", "4:5", "16:9"] as const;
export const COLOR_FILTERS = ["natural", "vibrante", "cinema", "quente", "frio", "vintage", "pb"] as const;
export const EXPORT_TARGETS = ["video", "wav", "mp3", "m4a"] as const;
export const CUT_LEVELS = ["off", "suave", "dinamico"] as const;
export const MUSIC_LEVELS = ["baixa", "media", "alta"] as const;

const correctionSchema = z
  .object({
    exposure: z.number().finite(),
    contrast: z.number().finite(),
    saturation: z.number().finite(),
    wb: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    notes: z.array(shortText(200)).max(20),
  })
  .strict();

const colorSchema = z
  .object({
    auto: z.boolean(),
    correction: correctionSchema.nullable(),
    filter: z.enum(COLOR_FILTERS),
    amount: z.number().min(0).max(100),
    sharpen: z.number().min(0).max(100),
    vignette: z.number().min(0).max(100),
  })
  .strict();

/** Ativo usado pela cadeia. `builtin` = gerado pelo próprio app (versionado por engine.dsp_version). */
const drumAssetSchema = z
  .object({
    id: shortText(64),
    builtin: z.boolean(),
    /**
     * Caminhos no Storage. As tabelas não têm updated_at nem hash; cada envio grava arquivos com um
     * UUID novo no caminho, então o caminho identifica o conteúdo (vazio quando builtin).
     */
    files: z.array(shortText(200)).max(12),
    room_files: z.array(shortText(200)).max(12),
  })
  .strict();

const irAssetSchema = z
  .object({ id: shortText(64), builtin: z.boolean(), file: shortText(200).nullable() })
  .strict();

const presetRefSchema = z
  .object({
    slug: shortText(120),
    /** preset_versions.id da versão atual do catálogo (null: preset do usuário, compartilhado ou virtual). */
    version_id: z.string().uuid().nullable(),
    /** A cadeia foi personalizada no editor (valores já congelados). */
    custom: z.boolean(),
    /** user_presets.id quando é um preset salvo pelo usuário. */
    user_preset_id: z.string().uuid().nullable(),
  })
  .strict();

export const exportJobSchema = z
  .object({
    schema_version: z.literal(1),
    kind: z.enum(["audio", "video"]),
    engine: z.object({ dsp_version: shortText(40), build_id: shortText(40) }).strict(),
    source: z
      .object({
        media: z.enum(["audio", "video"]),
        container: z.enum(["mp4", "webm"]),
        duration_s: z.number().finite().min(0),
        sample_rate: z.number().int().min(8000).max(192000),
        channels: z.number().int().min(1).max(8),
        /** Instante (s) da primeira amostra de áudio no arquivo. */
        audio_start_s: z.number().finite(),
        /** Hash de nome|tamanho|data do arquivo (o nome em si não vai no job); entra no idempotency_ref. */
        file_ref: z.string().regex(/^[0-9a-f]{8}$/),
        /** Hash de amostras do áudio decodificado (independe do nome). */
        content_fingerprint: z.string().regex(/^[0-9a-f]{8}$/),
      })
      .strict(),
    audio: z
      .object({
        preset: presetRefSchema,
        /**
         * Cadeia final (preset + bateria + reverb + master), com os parâmetros brutos {value, neutral}:
         * a intensidade é aplicada na execução. Só o master entra já congelado (freezeChain na
         * intensidade padrão dele), como o app faz hoje em withMaster.
         */
        chain: jobChainSchema,
        /** A que o runChain recebe (INTENSITIES; 100 quando a cadeia foi personalizada). */
        intensity: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]),
        master: z.object({ slug: shortText(120), version_id: z.string().uuid().nullable() }).strict().nullable(),
        /** Remoção de ruído: 0 = desligada, 1 = total. */
        denoise: z.number().min(0).max(1),
        social: z.object({ enabled: z.boolean(), target_lufs: z.union([z.literal(-18), z.literal(-16), z.literal(-14), z.literal(-9)]), ceiling_db: z.literal(-1) }).strict(),
        assets: z.object({ drum_samples: z.array(drumAssetSchema).max(12), irs: z.array(irAssetSchema).max(8) }).strict(),
        music: z
          .object({
            fingerprint: z.string().regex(/^[0-9a-f]{8}$/),
            level: z.enum(MUSIC_LEVELS),
            /** Onde a música estará no servidor (sempre null por enquanto: ainda não há envio). */
            upload_ref: z.string().nullable(),
          })
          .strict()
          .nullable(),
        /** Chave do áudio tratado (cache local); prefixo do idempotency_ref. */
        audio_ref: z.string().max(400),
      })
      .strict(),
    cuts: z
      .object({
        /** Os cortes entram no arquivo (no áudio puro o app não corta). */
        applied: z.boolean(),
        level: z.enum(CUT_LEVELS),
        /** Trechos mantidos, em segundos do original (já calculados). */
        segments: z.array(segmentSchema).min(1).max(20_000),
      })
      .strict(),
    /** Legendas gravadas no vídeo (já com as correções do usuário); null = sem legenda. */
    captions: z
      .object({
        captions: z.array(captionSchema).max(20_000),
        style: z.enum(CAPTION_STYLE_IDS),
        position: z.enum(CAPTION_POSITIONS),
      })
      .strict()
      .nullable(),
    look: z
      .object({
        format: z.enum(VIDEO_FORMATS),
        fit: z.enum(["blur", "crop"]),
        watermark: z.boolean(),
        font_family: shortText(1000),
        color: colorSchema.nullable(),
        cta: z.object({ text: shortText(10_000), handle: shortText(10_000), start: seconds, end: seconds }).strict().nullable(),
        before_after: z.boolean(),
        audiogram: z
          .object({ palette: z.number().int().min(0), title: shortText(10_000), has_image: z.boolean(), upload_ref: z.string().nullable() })
          .strict()
          .nullable(),
      })
      .strict(),
    output: z
      .object({
        target: z.enum(EXPORT_TARGETS),
        /** Contêiner do vídeo (null para áudio): mp4 quando recodifica; o do original quando só troca o áudio. */
        container: z.enum(["mp4", "webm"]).nullable(),
        /** Recodifica o vídeo quadro a quadro (false = só troca o áudio). */
        render: z.boolean(),
        quality: z.literal("high"),
      })
      .strict(),
    /** O mesmo p_ref usado hoje em spend_export_credit. */
    idempotency_ref: z.string().min(1).max(500),
  })
  .strict();

export type ExportJob = z.infer<typeof exportJobSchema>;
export type ExportTarget = (typeof EXPORT_TARGETS)[number];
