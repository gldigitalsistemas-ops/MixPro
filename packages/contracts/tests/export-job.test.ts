import { test } from "node:test";
import assert from "node:assert/strict";
import { exportJobSchema, type ExportJob } from "../src/index";

function validJob(): ExportJob {
  return {
    schema_version: 1,
    kind: "video",
    engine: { dsp_version: "2026.10.03", build_id: "abc123def456" },
    source: {
      media: "video",
      container: "mp4",
      duration_s: 12.5,
      sample_rate: 48000,
      channels: 2,
      audio_start_s: 0,
      file_ref: "0a1b2c3d",
      content_fingerprint: "deadbeef",
    },
    audio: {
      preset: { slug: "criador-youtuber", version_id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", custom: false, user_preset_id: null },
      chain: {
        schema_version: 1,
        chain: [
          { type: "highpass", params: { frequency_hz: 90, slope_db_oct: "18" } },
          { type: "eq_peak", params: { frequency_hz: 3500, gain_db: { value: 3, neutral: 0 }, q: 1.2 } },
        ],
      },
      intensity: 75,
      master: null,
      denoise: 0.9,
      social: { enabled: true, target_lufs: -14, ceiling_db: -1 },
      assets: {
        drum_samples: [{ id: "synth", builtin: true, files: [], room_files: [] }],
        irs: [{ id: "mp:g-4x12-greenback", builtin: true, file: null }],
      },
      music: { fingerprint: "01234567", level: "media", upload_ref: null },
      audio_ref: "0a1b2c3d_criador-youtuber_75_1_n90_x89abcdef",
    },
    cuts: { applied: true, level: "suave", segments: [{ start: 0, end: 4.2 }, { start: 5, end: 12.5 }] },
    captions: {
      captions: [{ start: 0.2, end: 1.1, words: [{ text: "Olá", start: 0.2, end: 0.6 }, { text: "pessoal", start: 0.6, end: 1.1 }] }],
      style: "destaque",
      position: "bottom",
    },
    look: {
      format: "9:16",
      fit: "blur",
      watermark: false,
      font_family: "Arial, sans-serif",
      color: { auto: true, correction: { exposure: 1.1, contrast: 1, saturation: 1.05, wb: [1, 1, 0.98], notes: ["luz"] }, filter: "vibrante", amount: 100, sharpen: 25, vignette: 0 },
      cta: { text: "Siga para mais", handle: "@perfil", start: 9, end: 12.5 },
      before_after: false,
      audiogram: null,
    },
    output: { target: "video", container: "mp4", render: true, quality: "high" },
    idempotency_ref: "0a1b2c3d_criador-youtuber_75_1_n90_x89abcdef_e76543210_video",
  };
}

test("ExportJob válido passa e sobrevive a JSON (sem perder nada)", () => {
  const job = validJob();
  const r = exportJobSchema.safeParse(job);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  const roundTrip = JSON.parse(JSON.stringify(job));
  assert.deepEqual(exportJobSchema.parse(roundTrip), job);
});

test("ExportJob de áudio: sem legenda, sem cor, sem contêiner de vídeo", () => {
  const job = validJob();
  job.kind = "audio";
  job.source.media = "audio";
  job.captions = null;
  job.look = { ...job.look, format: "original", color: null, cta: null };
  job.output = { target: "wav", container: null, render: false, quality: "high" };
  job.audio.music = null;
  job.audio.preset = { slug: "meu-preset", version_id: null, custom: true, user_preset_id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427" };
  job.audio.intensity = 100;
  const r = exportJobSchema.safeParse(job);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
});

test("ExportJob inválido é recusado", () => {
  const cases: [string, (j: Record<string, any>) => void][] = [
    ["versão do schema", (j) => (j.schema_version = 2)],
    ["campo desconhecido", (j) => (j.extra = 1)],
    ["intensidade fora das opções", (j) => (j.audio.intensity = 60)],
    ["alvo inválido", (j) => (j.output.target = "flac")],
    ["NaN em tempo", (j) => (j.cuts.segments[0].end = NaN)],
    ["sem trechos", (j) => (j.cuts.segments = [])],
    ["ruído acima de 1", (j) => (j.audio.denoise = 1.5)],
    ["alvo de loudness diferente", (j) => (j.audio.social.target_lufs = -16)],
    ["file_ref com o nome do arquivo", (j) => (j.source.file_ref = "meu-video.mp4")],
    ["módulo desconhecido na cadeia", (j) => j.audio.chain.chain.push({ type: "vst_pago", params: {} })],
    ["parâmetro fora da faixa", (j) => (j.audio.chain.chain[1].params.gain_db = { value: 99, neutral: 0 })],
    ["sem idempotency_ref", (j) => delete j.idempotency_ref],
    ["formato de vídeo inválido", (j) => (j.look.format = "21:9")],
    ["Blob/objeto estranho no lugar da música", (j) => (j.audio.music = { fingerprint: "01234567", level: "media", upload_ref: null, channels: [] })],
    ["version_id que não é uuid", (j) => (j.audio.preset.version_id = "v1")],
  ];
  for (const [name, mutate] of cases) {
    const job = JSON.parse(JSON.stringify(validJob()));
    mutate(job);
    assert.equal(exportJobSchema.safeParse(job).success, false, name);
  }
});

test("cadeia do job aceita mixagem longa + master (até 80 módulos)", () => {
  const job = validJob();
  const step = { type: "gain", params: { gain_db: 0 } } as unknown as ExportJob["audio"]["chain"]["chain"][number];
  job.audio.chain.chain = Array.from({ length: 41 }, () => step);
  assert.equal(exportJobSchema.safeParse(job).success, true);
  job.audio.chain.chain = Array.from({ length: 81 }, () => step);
  assert.equal(exportJobSchema.safeParse(job).success, false);
});
