import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { exportJobSchema, jobChainSchema, presetChainSchema } from "@mixpro/contracts";
import { runChain, type ChainDoc } from "@/lib/dsp/chain";
import type { Signal } from "@/lib/dsp/types";
import { withDrumTweaks, type DrumTweaks } from "@/lib/drums/tweaks";
import { DEFAULT_LOOK, lookIsActive, lookMatrix, type ColorLook } from "@/lib/media/color";
import type { Look, VideoFormat } from "@/lib/media/compose";
import type { Segment } from "@/lib/media/cuts";
import { starterChain, withMaster } from "@/lib/mix";
import type { StudioPreset } from "@/lib/presets";
import { withReverb, type ReverbTweak } from "@/lib/reverb-tweak";
import { freezeChain } from "@/lib/user-presets";
import { buildExportJob, composeChain, ExportJobError, type ExportState } from "./build-job";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync(join(FIXTURES, "chains.json"), "utf8"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ------------------------------------------------------------------ cópia LITERAL do código antigo do export-panel
// (commit a05d00c, components/studio/export-panel.tsx linhas 77–86, 123–140 e 191)
const legacy = (() => {
  function fnv(text: string): string {
    let h = 0x811c9dc5;
    for (const ch of text) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  const fileKey = (f: { name: string; size: number; lastModified: number }) => fnv(`${f.name}|${f.size}|${f.lastModified}`);
  return (s: ExportState, chain: ChainDoc) => {
    const media = s.media;
    const preset = s.preset;
    const { intensity, social, denoise, segments, cutting, look, audiogram, music } = s;
    const comparing = s.comparing;
    const audioKey = preset && chain
      ? `${fileKey(media.file)}_${preset.slug}_${intensity}_${social ? 1 : 0}_n${Math.round(denoise * 100)}_x${fnv(JSON.stringify(chain))}`
      : null;
    const editKey = fnv(
      JSON.stringify([
        cutting ? segments.map((s) => [s.start.toFixed(2), s.end.toFixed(2)]) : 0,
        look.format,
        look.fit,
        look.watermark,
        look.captions ? [look.captions.captions, look.captions.style, look.captions.position] : 0,
        audiogram ? [audiogram.palette, audiogram.title, Boolean(audiogram.image)] : 0,
        music ? [music.name, music.level] : 0,
        comparing ? "antes-depois" : 0,
        look.cta ? [look.cta.text, look.cta.handle] : 0,
        lookIsActive(look.color) ? [lookMatrix(look.color!).map((v) => v.toFixed(3)), look.color!.sharpen, look.color!.vignette] : 0,
      ]),
    );
    const settingsKey = audioKey && `${audioKey}_e${editKey}`;
    const resultKey = `${settingsKey}_${s.target}`;
    return { audioKey, resultKey };
  };
})();

/** Cadeia montada como no studio.tsx (drumChain → mixChain → chain, cada um em seu useMemo). */
function studioChain(base: ChainDoc, drumEff: DrumTweaks | null, reverbTweak: ReverbTweak | null, masterPreset: StudioPreset | null) {
  const drumChain = withDrumTweaks(base, drumEff);
  const mixChain = withReverb(drumChain, reverbTweak);
  return withMaster(mixChain, masterPreset);
}

// ------------------------------------------------------------------ entradas variadas (determinísticas)

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SR = 48000;
const tone = (seconds: number, ch = 2): Signal =>
  Array.from({ length: ch }, (_, c) => {
    const x = new Float32Array(Math.round(SR * seconds));
    for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin((2 * Math.PI * (220 + 30 * c) * i) / SR);
    return x;
  });

const MASTER: StudioPreset = {
  id: "m1",
  slug: "master-pop-moderno",
  name: "Master pop",
  description: null,
  style: null,
  categoryId: "master-pop",
  chain: clone(CHAINS["master-pop-moderno"]),
  defaultIntensity: 75,
  versionId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
};

const DRUMS: DrumTweaks = {
  samples: { kick: "6f1c6c1e-1d1a-4a4b-9a55-2b1b0c6d7e01", snare: "synth", tom1: "synth", tom2: "synth", floor: "synth", rimshot: "synth" },
  kick: 2,
  snare: -1,
  toms: 0,
  floor: 0,
  kick_tune: 0,
  snare_tune: 1,
  toms_tune: 0,
  floor_tune: 0,
  rimshot: 30,
  room: 40,
  sample_mix: 70,
  reverb_size: "large",
  reverb: 35,
  kick_sens: 50,
  snare_sens: 62,
  tom_sens: 41,
};

const NAMES = ["video.mp4", "Gravação do culto 🎤.mov", "a|b|c.mp4", "música (final) – v2.m4a", "😀😀.webm"];
const FORMATS: VideoFormat[] = ["original", "9:16", "1:1", "4:5", "16:9"];

function makeState(seed: number): ExportState {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const slug = pick(["criador-youtuber", "guitarra-amp-rock", "bateria-pop-rock", "violao-cel-natural", "do-zero-voz"]);
  const base = slug === "do-zero-voz" ? starterChain("voz") : clone(CHAINS[slug]);
  const customizing = r() < 0.25;
  const intensity = customizing ? 100 : pick([25, 50, 75, 100] as const);
  const kind = r() < 0.75 ? "video" : "audio";
  const duration = 5 + Math.round(r() * 600) / 10;
  const segments: Segment[] =
    r() < 0.5
      ? [{ start: 0, end: duration }]
      : [{ start: 0.1234567, end: 2.345678 }, { start: 3.0000001, end: duration - 0.4 }];
  const color: ColorLook | null =
    kind === "video" && r() < 0.7
      ? {
          ...DEFAULT_LOOK,
          auto: r() < 0.5,
          correction: r() < 0.5 ? { exposure: 1.07, contrast: 1.02, saturation: 1.1, wb: [1.01, 1, 0.97], notes: ["Clareamos"] } : null,
          filter: pick(["natural", "vibrante", "cinema", "pb"] as const),
          amount: pick([100, 55]),
          sharpen: pick([0, 25, 60]),
          vignette: pick([0, 30]),
        }
      : null;
  const captions =
    kind === "video" && r() < 0.5
      ? {
          captions: [
            { start: 0.5, end: 1.4, words: [{ text: "Olá", start: 0.5, end: 0.9 }, { text: "pessoal!", start: 0.9, end: 1.4 }] },
            { start: 1.5, end: 2.2, words: [{ text: "ação ✨", start: 1.5, end: 2.2 }] },
          ],
          style: pick(["destaque", "karaoke", "emoji"] as const),
          position: pick(["top", "bottom"] as const),
          fontFamily: "Arial, sans-serif",
        }
      : null;
  const look: Look = {
    format: kind === "video" ? pick(FORMATS) : "original",
    fit: pick(["blur", "crop"] as const),
    watermark: r() < 0.5,
    captions,
    fontFamily: "Arial, sans-serif",
    color,
    cta: kind === "video" && r() < 0.5 ? { text: pick(["Siga para mais", "  Inscreva-se  "]), handle: pick(["@perfil", ""]), start: duration - 3.5, end: duration } : null,
  };
  const music = r() < 0.3 ? { name: pick(["fundo.mp3", "trilha 2.wav"]), level: pick(["baixa", "media", "alta"] as const), channels: tone(1) } : null;
  return {
    target: kind === "video" ? pick(["video", "mp3", "wav", "m4a"] as const) : pick(["mp3", "wav", "m4a"] as const),
    media: {
      file: { name: pick(NAMES), size: Math.floor(r() * 5e8), lastModified: 1_700_000_000_000 + Math.floor(r() * 1e10) },
      kind,
      videoContainer: pick(["mp4", "webm"] as const),
      sampleRate: pick([44100, 48000]),
      channels: tone(0.5, pick([1, 2])),
      audioStart: pick([0, 0.021333]),
      duration,
    },
    preset: { slug, versionId: slug === "do-zero-voz" ? null : "1b4e28ba-2fa1-41d2-883f-0016d3cca427", userPresetId: undefined },
    chainParts: {
      base: customizing ? freezeChain(base, 75) : base,
      drums: slug === "bateria-pop-rock" && r() < 0.7 ? DRUMS : null,
      reverb: r() < 0.4 ? { size: pick(["small", "medium", "large"] as const), amount: pick([0, 33, 80]) } : null,
      master: r() < 0.5 && !slug.startsWith("master") ? MASTER : null,
    },
    customizing,
    intensity,
    denoise: pick([0, 0.9, 1]),
    social: r() < 0.7,
    cutLevel: segments.length > 1 ? pick(["suave", "dinamico"] as const) : "off",
    segments,
    cutting: kind === "video" && segments.length > 1,
    look,
    comparing: kind === "video" && r() < 0.2,
    audiogram: null,
    music,
    library: {
      drums: [{ id: "6f1c6c1e-1d1a-4a4b-9a55-2b1b0c6d7e01", files: ["kick/6f1c/01.wav", "kick/6f1c/02.wav"], room_files: [] }],
      irs: [],
    },
    buildId: "test-build",
  };
}

// ------------------------------------------------------------------ testes

test("p_ref (idempotency_ref) idêntico ao código antigo em 400 combinações", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 400; seed++) {
    const s = makeState(seed);
    const old = legacy(s, studioChain(s.chainParts.base, s.chainParts.drums, s.chainParts.reverb, s.chainParts.master));
    const job = buildExportJob(s);
    assert.equal(job.idempotency_ref, old.resultKey, `seed ${seed}`);
    assert.equal(job.audio.audio_ref, old.audioKey, `seed ${seed}`);
    seen.add(job.idempotency_ref);
  }
  assert.ok(seen.size > 350, "as combinações devem gerar refs diferentes");
});

test("(a) cadeia do job == cadeia do estúdio (mesmo JSON, mesma ordem de chaves)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = makeState(seed);
    const p = s.chainParts;
    const job = buildExportJob(s);
    assert.equal(JSON.stringify(job.audio.chain), JSON.stringify(studioChain(p.base, p.drums, p.reverb, p.master)), `seed ${seed}`);
    assert.equal(JSON.stringify(composeChain(p)), JSON.stringify(job.audio.chain));
  }
});

test("(b) master: +0,004 arredonda para o mesmo valor (nada muda); +0,02 muda cadeia, p_ref e som", () => {
  const s = makeState(7);
  s.chainParts = { base: clone(CHAINS["violao-cel-natural"]), drums: null, reverb: null, master: MASTER };
  const bump = (delta: number): ExportState => {
    const m = clone(MASTER);
    const shelf = m.chain.chain.find((x) => x.type === "eq_shelf")!;
    const g = shelf.params!.gain_db as { value: number; neutral: number };
    shelf.params = { ...shelf.params, gain_db: { ...g, value: g.value + delta } };
    return { ...s, chainParts: { ...s.chainParts, master: m } };
  };
  const sound = (job: ReturnType<typeof buildExportJob>) => {
    const out = runChain(tone(1), SR, job.audio.chain, job.audio.intensity);
    const h = createHash("sha256");
    for (const ch of out) h.update(Buffer.from(ch.buffer));
    return h.digest("hex");
  };
  const base = buildExportJob(s);
  const tiny = buildExportJob(bump(0.004));
  const big = buildExportJob(bump(0.02));
  assert.deepEqual(tiny.audio.chain, base.audio.chain);
  assert.equal(tiny.idempotency_ref, base.idempotency_ref);
  assert.equal(sound(tiny), sound(base));
  assert.notDeepEqual(big.audio.chain, base.audio.chain);
  assert.notEqual(big.idempotency_ref, base.idempotency_ref);
  assert.notEqual(sound(big), sound(base));
});

test("intensidade não é congelada: a cadeia guarda {value, neutral} e a intensidade vai à parte", () => {
  const s = makeState(3);
  s.chainParts = { base: clone(CHAINS["criador-youtuber"]), drums: null, reverb: null, master: null };
  s.customizing = false;
  for (const intensity of [25, 50, 75, 100]) {
    const job = buildExportJob({ ...s, intensity });
    assert.equal(job.audio.intensity, intensity);
    assert.deepEqual(job.audio.chain, CHAINS["criador-youtuber"]);
  }
});

test("job é JSON puro e passa no schema", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const job = buildExportJob(makeState(seed));
    const back = JSON.parse(JSON.stringify(job));
    assert.deepEqual(back, job, `seed ${seed}`);
    assert.equal(exportJobSchema.safeParse(back).success, true);
    const walk = (v: unknown): void => {
      assert.ok(v === null || ["string", "number", "boolean", "object"].includes(typeof v));
      if (v && typeof v === "object") {
        assert.ok(Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype, "só objetos simples e arrays");
        Object.values(v).forEach(walk);
      }
    };
    walk(job);
  }
});

test("decisão de render e contêiner", () => {
  const s = makeState(11);
  s.media = { ...s.media, kind: "video", videoContainer: "webm" };
  const plain: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "x", color: null, cta: null };
  const off = { ...s, target: "video" as const, look: plain, cutting: false, comparing: false };
  assert.deepEqual(buildExportJob(off).output, { target: "video", container: "webm", render: false, quality: "high" });
  assert.equal(buildExportJob({ ...off, comparing: true }).output.render, true);
  assert.equal(buildExportJob({ ...off, look: { ...plain, format: "9:16" } }).output.container, "mp4");
  assert.deepEqual(buildExportJob({ ...off, target: "wav" }).output, { target: "wav", container: null, render: false, quality: "high" });
  const audiogram = { ...off, media: { ...off.media, kind: "audio" as const } };
  assert.equal(buildExportJob(audiogram).output.render, true);
});

test("ativos: samples do Storage com os caminhos; sintetizados e caixas embutidas como builtin", () => {
  const s = makeState(5);
  s.chainParts = { base: clone(CHAINS["bateria-pop-rock"]), drums: DRUMS, reverb: null, master: null };
  const job = buildExportJob(s);
  assert.deepEqual(job.audio.assets.drum_samples, [
    { id: "6f1c6c1e-1d1a-4a4b-9a55-2b1b0c6d7e01", builtin: false, files: ["kick/6f1c/01.wav", "kick/6f1c/02.wav"], room_files: [] },
    { id: "synth", builtin: true, files: [], room_files: [] },
  ]);
  s.chainParts = { base: starterChain("guitar"), drums: null, reverb: null, master: null };
  assert.deepEqual(buildExportJob(s).audio.assets.irs, [{ id: "mp:g-2x12-alnico", builtin: true, file: null }]);
  assert.equal(buildExportJob(s).engine.build_id, "test-build");
  assert.match(buildExportJob(s).engine.dsp_version, /^\d{4}\.\d{2}\.\d{2}/);
});

test("todas as cadeias de preset das migrações (e as do zero) cabem no job, com e sem master", () => {
  const dir = fileURLToPath(new URL("../../../../supabase/migrations", import.meta.url));
  const chains: ChainDoc[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf8");
    let i = 0;
    while ((i = sql.indexOf(`'{"schema_version"`, i)) >= 0) {
      const end = sql.indexOf(`]}'`, i);
      const raw = sql.slice(i + 1, end + 2).replace(/''/g, "'");
      i = end;
      try {
        chains.push(JSON.parse(raw));
      } catch {
        // trecho que não é uma cadeia completa (ex.: concatenação no SQL)
      }
    }
  }
  for (const kind of ["drums", "guitar", "bass", "acoustic", "piano", "voz"] as const) chains.push(starterChain(kind));
  assert.ok(chains.length > 30, `encontrou ${chains.length} cadeias`);
  for (const c of chains) {
    assert.equal(presetChainSchema.safeParse(c).success, true, JSON.stringify(c).slice(0, 120));
    for (const intensity of [25, 100]) {
      for (const master of [null, MASTER]) {
        const merged = withMaster(intensity === 100 ? freezeChain(c, 75) : c, master);
        assert.equal(jobChainSchema.safeParse(merged).success, true, JSON.stringify(merged).slice(0, 160));
      }
    }
  }
});

test("erro de validação não expõe valores (só os caminhos dos campos)", () => {
  const s = makeState(9);
  s.intensity = 60;
  s.look = { ...s.look, cta: { text: "SEGREDO-123", handle: "@x", start: NaN, end: 1 } };
  assert.throws(
    () => buildExportJob(s),
    (err: unknown) => {
      assert.ok(err instanceof ExportJobError);
      assert.ok(!err.message.includes("SEGREDO"));
      assert.ok(!err.message.includes("60"));
      assert.ok(err.paths.includes("audio.intensity"));
      assert.ok(err.paths.includes("look.cta.start"));
      return true;
    },
  );
});
