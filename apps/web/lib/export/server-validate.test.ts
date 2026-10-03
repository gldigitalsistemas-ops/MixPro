import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { exportJobSchema, serverExportJobSchema, SERVER_LIMITS, type ExportJob } from "@mixpro/contracts";
import type { ChainDoc } from "@/lib/dsp/chain";
import { DSP_VERSION } from "@/lib/dsp/version";
import { DEFAULT_LOOK } from "@/lib/media/color";
import type { Look } from "@/lib/media/compose";
import { starterChain } from "@/lib/mix";
import { buildExportJob, type ExportState } from "./build-job";
import { validateServerJob } from "./server-validate";

const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync(join(fileURLToPath(new URL("./fixtures", import.meta.url)), "chains.json"), "utf8"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const SR = 48000;
const plain: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial, sans-serif", color: null, cta: null };

function state(o: Partial<ExportState> = {}): ExportState {
  const ch = new Float32Array(SR).map((_, i) => Math.sin(i / 20) * 0.2);
  return {
    target: "mp3",
    media: { file: { name: "Gravação 🎤.m4a", size: 123456, lastModified: 1_700_000_000_000 }, kind: "audio", videoContainer: "mp4", sampleRate: SR, channels: [ch, ch.map((v) => v * 0.9)], audioStart: 0, duration: 95.5 },
    preset: { slug: "criador-youtuber", versionId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427" },
    chainParts: { base: clone(CHAINS["criador-youtuber"]), drums: null, reverb: null, master: null },
    customizing: false,
    intensity: 75,
    denoise: 0.9,
    social: true,
    cutLevel: "off",
    segments: [{ start: 0, end: 95.5 }],
    cutting: false,
    look: plain,
    comparing: false,
    audiogram: null,
    music: null,
    library: { drums: [], irs: [] },
    buildId: "t",
    ...o,
  };
}

const VALID: Record<string, ExportState> = {
  "áudio → MP3": state(),
  "áudio → WAV, guitarra com caixa embutida": state({ target: "wav", chainParts: { base: starterChain("guitar"), drums: null, reverb: null, master: null }, denoise: 0 }),
  "áudio → M4A, cadeia personalizada (intensidade 100)": state({ target: "m4a", customizing: true, intensity: 100 }),
  "vídeo → MP3 com cortes": state({
    media: { ...state().media, kind: "video", audioStart: 0.021333 },
    cutting: true,
    cutLevel: "suave",
    segments: [{ start: 0.021333, end: 12.5 }, { start: 13.1, end: 95.5 }],
    // num alvo de áudio o visual não importa para o arquivo (só entra no p_ref)
    look: { ...plain, format: "9:16", watermark: true, color: DEFAULT_LOOK },
    comparing: true,
  }),
  "vídeo → só trocar o áudio": state({ target: "video", media: { ...state().media, kind: "video" } }),
};

const body = (j: unknown) => JSON.stringify(j);
/** Job solto para adulterar campo a campo nos testes (o validador recebe texto, não tipos). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

test("jobs reais do app (buildExportJob) passam na validação do servidor", () => {
  for (const [name, s] of Object.entries(VALID)) {
    const job = buildExportJob(s);
    const r = validateServerJob(body(job));
    assert.equal(r.ok, true, `${name}: ${JSON.stringify(r)}`);
  }
});

/** Cada adulteração e o código esperado. */
const TAMPER: [string, ExportState, (j: Loose) => void, string][] = [
  ["legendas (letra) vindas do cliente", VALID["áudio → MP3"], (j) => (j.captions = { captions: [], style: "destaque", position: "bottom" }), "OUT_OF_SCOPE"],
  ["CTA", VALID["áudio → MP3"], (j) => (j.look.cta = { text: "Siga", handle: "@x", start: 1, end: 2 }), "OUT_OF_SCOPE"],
  ["música de fundo (fora da v1)", VALID["áudio → MP3"], (j) => (j.audio.music = { fingerprint: "01234567", level: "media", upload_ref: null }), "OUT_OF_SCOPE"],
  ["audiograma", VALID["áudio → MP3"], (j) => (j.look.audiogram = { palette: 0, title: "x", has_image: false, upload_ref: null }), "OUT_OF_SCOPE"],
  ["render declarado", VALID["vídeo → só trocar o áudio"], (j) => (j.output.render = true), "OUT_OF_SCOPE"],
  ["vídeo com cor ativa fingindo não precisar de render", VALID["vídeo → só trocar o áudio"], (j) => (j.look.color = { ...DEFAULT_LOOK }), "OUT_OF_SCOPE"],
  ["vídeo com antes → depois", VALID["vídeo → só trocar o áudio"], (j) => (j.look.before_after = true), "OUT_OF_SCOPE"],
  ["kind e alvo incoerentes", VALID["áudio → MP3"], (j) => (j.kind = "video"), "INVALID_JOB"],
  ["mais de 10 min", VALID["áudio → MP3"], (j) => (j.source.duration_s = SERVER_LIMITS.maxDurationS + 1), "TOO_LONG"],
  ["3 canais", VALID["áudio → MP3"], (j) => (j.source.channels = 3), "INVALID_JOB"],
  ["cadeia longa demais", VALID["áudio → MP3"], (j) => (j.audio.chain.chain = Array.from({ length: 42 }, () => ({ type: "gain", params: { gain_db: 0 } }))), "LIMIT"],
  ["3 amplificadores", VALID["áudio → WAV, guitarra com caixa embutida"], (j) => j.audio.chain.chain.push(clone(j.audio.chain.chain[0]), clone(j.audio.chain.chain[0])), "LIMIT"],
  ["id de sample com caminho", VALID["áudio → MP3"], (j) => (j.audio.assets.drum_samples = [{ id: "../../segredo", builtin: false, files: ["x"], room_files: [] }]), "INVALID_JOB"],
  ["id de IR estranho", VALID["áudio → MP3"], (j) => (j.audio.assets.irs = [{ id: "http://evil", builtin: false, file: "x" }]), "INVALID_JOB"],
  ["cortes sobrepostos", VALID["vídeo → MP3 com cortes"], (j) => (j.cuts.segments = [{ start: 0.1, end: 20 }, { start: 10, end: 30 }]), "INVALID_JOB"],
  ["corte além do fim do áudio", VALID["vídeo → MP3 com cortes"], (j) => (j.cuts.segments = [{ start: 0.1, end: 500 }]), "INVALID_JOB"],
  ["cortes demais", VALID["vídeo → MP3 com cortes"], (j) => (j.cuts.segments = Array.from({ length: SERVER_LIMITS.maxSegments + 1 }, (_, i) => ({ start: i * 0.04, end: i * 0.04 + 0.02 }))), "LIMIT"],
  ["intensidade trocada (cobraria outro resultado com o mesmo p_ref)", VALID["áudio → MP3"], (j) => (j.audio.intensity = 50), "REF_INVALID"],
  ["parâmetro da cadeia trocado", VALID["áudio → MP3"], (j) => (j.audio.chain.chain[2].params.gain_db.value = 6), "REF_INVALID"],
  ["ruído trocado", VALID["áudio → MP3"], (j) => (j.audio.denoise = 1), "REF_INVALID"],
  ["cortes trocados num alvo de áudio", VALID["vídeo → MP3 com cortes"], (j) => (j.cuts.segments = [{ start: 0.021333, end: 50 }]), "REF_INVALID"],
  ["file_ref trocado", VALID["áudio → MP3"], (j) => (j.source.file_ref = "deadbeef"), "REF_INVALID"],
  ["alvo trocado sem mudar o p_ref", VALID["áudio → MP3"], (j) => (j.output.target = "wav"), "REF_INVALID"],
  ["p_ref fora do formato do banco", VALID["áudio → MP3"], (j) => (j.idempotency_ref = "a b c d e f g h"), "REF_INVALID"],
];

test("adulterações são recusadas com o código certo", () => {
  for (const [name, s, mutate, code] of TAMPER) {
    const job = clone(buildExportJob(s)) as Loose;
    mutate(job);
    const r = validateServerJob(body(job));
    assert.equal(r.ok, false, name);
    if (!r.ok) assert.equal(r.code, code, `${name}: ${r.code} ${r.paths.join(",")}`);
  }
});

test("versão do DSP diferente, JSON inválido e JSON grande demais", () => {
  const ok = body(buildExportJob(VALID["áudio → MP3"]));
  const v = validateServerJob(ok, "outra-versao");
  assert.equal(v.ok ? "" : v.code, "VERSION_MISMATCH");
  const bad = validateServerJob("{não é json");
  assert.equal(bad.ok ? "" : bad.code, "INVALID_JOB");
  const big = validateServerJob(ok.replace("}", `,"x":"${"a".repeat(SERVER_LIMITS.maxJobBytes)}"}`));
  assert.equal(big.ok ? "" : big.code, "TOO_LARGE");
  assert.equal(validateServerJob(ok, DSP_VERSION).ok, true);
});

test("o p_ref é recalculado sobre o JSON bruto (a ordem de chaves do cliente é a que vale)", () => {
  // cadeia com as chaves fora da ordem do schema (como pode vir do banco ou do editor)
  const base = clone(CHAINS["criador-youtuber"]);
  base.chain = base.chain.map((m) => ({ params: Object.fromEntries(Object.entries(m.params ?? {}).reverse()), type: m.type }));
  const job = buildExportJob(state({ chainParts: { base, drums: null, reverb: null, master: null } }));
  assert.equal(validateServerJob(body(job)).ok, true, "o job como o cliente mandou passa");
  // re-serializar pela saída do zod reordena as chaves: o hash da cadeia muda e o p_ref não confere
  const reordered = body(exportJobSchema.parse(JSON.parse(body(job))));
  assert.notEqual(reordered, body(job));
  assert.equal((validateServerJob(reordered) as { code?: string }).code, "REF_INVALID");
});

test("o erro nunca devolve valores recebidos (só código e caminhos)", () => {
  const job = clone(buildExportJob(VALID["áudio → MP3"])) as Loose;
  job.captions = { captions: [{ start: 0, end: 1, words: [{ text: "LETRA-INEDITA", start: 0, end: 1 }] }], style: "destaque", position: "bottom" };
  job.look.cta = { text: "TEXTO-SECRETO", handle: "@x", start: 0, end: 1 };
  const r = validateServerJob(body(job));
  assert.equal(r.ok, false);
  const out = JSON.stringify(r);
  assert.ok(!out.includes("LETRA-INEDITA") && !out.includes("TEXTO-SECRETO"), out);
});

test("o schema estrito é um superconjunto do geral (todo job aceito é um ExportJob válido)", () => {
  for (const s of Object.values(VALID)) {
    const job: ExportJob = buildExportJob(s);
    assert.equal(serverExportJobSchema.safeParse(job).success, true);
    assert.equal(exportJobSchema.safeParse(job).success, true);
  }
});
