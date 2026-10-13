/**
 * Recursos premium no serviço (chamados pelo runTool):
 *   stems_premium  VS Premium 7 faixas (Music.AI) + "outros" = música − soma das 6 faixas
 *   mix_ia         Mix & Master IA (motor de mixagem; referência separada com o HT-Demucs local)
 *   compose        Produção da composição (gerador em GPU) com controle de qualidade e folha de cifra
 *   voice_final    Voz finalizada: voz gravada + base escolhida → afinação, mix e master
 *
 * Prévia (preview=true): só um trecho de 30 s é processado (custo mínimo) e só arquivos curtos saem.
 * Entrega final: arquivos completos + trechos "vitrine-antes"/"vitrine-depois" (usados só se a pessoa
 * autorizar a vitrine).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PremiumToolId } from "@mixpro/contracts";
import { MIX_GENRES, type MixGenre, type MixTrack } from "@mixpro/contracts";
import type { ChainDoc } from "@/lib/dsp/chain";
import { finalizeForSocial } from "@/lib/dsp/chain";
import { integratedLoudness } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { decodeMedia, type DecodedMedia } from "@/lib/export/ffmpeg-decode";
import { encodeWithFfmpeg } from "@/lib/export/ffmpeg-encode";
import { chordAgreement, chordPt, detectChords, progression } from "@/lib/mixengine/chords";
import { CLIP_SECONDS, cut, loudestWindow, matchLoudness, roughMix } from "@/lib/mixengine/clips";
import { mixSession, type EngineTrack, type ReferenceStems } from "@/lib/mixengine/engine";
import { scaleOf, segmentNotes, trackPitch } from "@/lib/mixengine/pitch";
import { PdfDoc } from "@/lib/report/pdf";
import { detectBpm, detectKey } from "@/lib/tools/analysis";
import { alignOffset, toRate } from "@/lib/tools/mixing";
import { clickTrack, trackBeats } from "@/lib/vs/tempo";
import type { Composer } from "./adapters/composer";
import { stemOf, type StemSeparator } from "./adapters/musicai";
import { JobError } from "./errors";
import { separateStems, StemsUnavailable } from "./stems";

export type OutFile = { name: string; channels?: Signal; sampleRate?: number; format?: "wav" | "wav24" | "mp3" | "m4a" | "flac"; zip?: boolean; bytes?: Uint8Array; ext?: string };

export type PremiumCtx = {
  ffmpeg: string;
  ffprobe: string;
  timeoutS: number;
  musicai?: StemSeparator | null;
  composer?: Composer | null;
  /** URLs temporárias do nosso armazenamento (o gerador lê a guia e grava as versões). */
  presign?: (method: "GET" | "PUT", key: string, ttlS: number) => string;
  /** Lê um objeto (versões gravadas pelo gerador). */
  readKey?: (key: string) => Promise<Uint8Array>;
  putKey?: (key: string, data: Uint8Array) => Promise<void>;
  jobId: string;
};

export type PremiumResult = { files: OutFile[]; measures: Record<string, unknown>; zip?: string; apiUsd: number };

const EXT: Record<string, string> = { wav: "wav", wav24: "wav", mp3: "mp3", m4a: "m4a", flac: "flac" };
export const CLIP_BEFORE = "vitrine-antes.m4a";
export const CLIP_AFTER = "vitrine-depois.m4a";

const asGenre = (g: unknown): MixGenre => ((MIX_GENRES as readonly string[]).includes(String(g)) ? (g as MixGenre) : "pop");
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "pista";

/** Decodifica bytes (WAV/MP3/FLAC…) com o FFmpeg na taxa pedida. */
async function decodeBytes(ctx: PremiumCtx, bytes: Uint8Array, sr: number): Promise<Signal> {
  const dir = await mkdtemp(join(tmpdir(), "mixpro-prem-"));
  try {
    const f = join(dir, "in.bin");
    await writeFile(f, bytes);
    const m = await decodeMedia(f, { ffmpeg: ctx.ffmpeg, ffprobe: ctx.ffprobe, maxDurationS: 1200, timeoutS: ctx.timeoutS });
    return m.sampleRate === sr ? m.channels : toRate(m.channels, m.sampleRate, sr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const fit = (x: Signal, n: number): Signal =>
  x.map((c) => {
    if (c.length === n) return c;
    const o = new Float32Array(n);
    o.set(c.subarray(0, n));
    return o;
  }) as Signal;

const toStereo = (x: Signal): Signal => (x.length === 2 ? x : ([x[0], x[0].slice()] as Signal));

/** Trechos da vitrine (mesmo instante nos dois; "antes" no volume do "depois"). */
function clips(before: Signal, after: Signal, sr: number): OutFile[] {
  const start = loudestWindow(after, sr, CLIP_SECONDS);
  const a = cut(toStereo(after), sr, start, CLIP_SECONDS);
  const b = matchLoudness(cut(toStereo(before), sr, Math.min(start, Math.max(0, before[0].length - CLIP_SECONDS * sr)), CLIP_SECONDS), sr, a);
  return [
    { name: CLIP_BEFORE, channels: b, sampleRate: sr, format: "m4a" },
    { name: CLIP_AFTER, channels: a, sampleRate: sr, format: "m4a" },
  ];
}

/** Janela de prévia: o trecho de 30 s com mais energia (de um sinal de referência). */
function previewWindow(guide: Signal, sr: number): number {
  return loudestWindow(guide, sr, CLIP_SECONDS);
}

function sliceAll(list: Signal[], start: number, seconds: number, sr: number): Signal[] {
  const n = Math.round(seconds * sr);
  return list.map((x) => x.map((c) => c.slice(start, start + n)) as Signal);
}

// ------------------------------------------------------------------ VS Premium

async function stemsPremium(p: Record<string, unknown>, media: DecodedMedia[], ctx: PremiumCtx, onProgress: (v: number) => void): Promise<PremiumResult> {
  if (!ctx.musicai) throw new JobError("TOOL_UNAVAILABLE");
  const m = media[0];
  const sr = m.sampleRate;
  const preview = p.preview === true;
  let src: Signal = toStereo(m.channels);
  if (preview) src = sliceAll([src], previewWindow(src, sr), CLIP_SECONDS, sr)[0];
  const n = src[0].length;
  const flac = await encodeWithFfmpeg(ctx.ffmpeg, src, sr, "flac", ctx.timeoutS);
  onProgress(0.1);
  let outs: Record<string, Uint8Array>;
  try {
    outs = await ctx.musicai.separate(flac, "audio/flac");
  } catch {
    throw new JobError("EXTERNAL_FAILED");
  }
  onProgress(0.6);
  const order = ["voz", "bateria", "baixo", "guitarra", "violao", "teclado"] as const;
  const stems: Partial<Record<(typeof order)[number], Signal>> = {};
  for (const [name, bytes] of Object.entries(outs)) {
    const which = stemOf(name);
    if (!which || stems[which]) continue;
    stems[which] = fit(toStereo(await decodeBytes(ctx, bytes, sr)), n);
  }
  if (!stems.voz && !stems.bateria) throw new JobError("EXTERNAL_FAILED");
  // "outros" = música − soma das faixas: efeitos, loops, cordas, sopros… e a soma volta a ser a música
  const outros = src.map((c) => c.slice()) as Signal;
  for (const s of Object.values(stems)) for (let ch = 0; ch < 2; ch++) for (let i = 0; i < n; i++) outros[ch][i] -= s![ch][i];
  const all: [string, Signal][] = [...order.filter((k) => stems[k]).map((k) => [k, stems[k]!] as [string, Signal]), ["outros", outros]];
  const label: Record<string, string> = { voz: "voz", bateria: "bateria", baixo: "baixo", guitarra: "guitarra", violao: "violao", teclado: "teclado", outros: "outros" };
  const fmt = (p.format as OutFile["format"]) ?? "wav";
  const files: OutFile[] = [];
  for (const [k, x] of all) {
    if (!preview) files.push({ name: `${label[k]}.${EXT[fmt]}`, channels: x, sampleRate: sr, format: fmt, zip: true });
    files.push({ name: `play-${label[k]}.m4a`, channels: x, sampleRate: sr, format: "m4a" });
  }
  // vitrine: antes = a música; depois = o playback (tudo menos a voz)
  const playback = src.map((c, ch) => {
    const o = c.slice();
    if (stems.voz) for (let i = 0; i < n; i++) o[i] -= stems.voz[ch][i];
    return o;
  }) as Signal;
  files.push(...clips(src, playback, sr));
  const minutes = n / sr / 60;
  return { files, measures: { faixas: all.map(([k]) => k), minutos: Math.round(minutes * 100) / 100 }, zip: preview ? undefined : "vs-premium-7-faixas.zip", apiUsd: minutes * ctx.musicai.usdPerMinute };
}

// ------------------------------------------------------------------ referência (HT-Demucs local)

async function referenceStems(ref: Signal, sr: number, preview: boolean): Promise<ReferenceStems | null> {
  let x = ref;
  if (preview) x = sliceAll([ref], loudestWindow(ref, sr, CLIP_SECONDS), CLIP_SECONDS, sr)[0];
  else if (x[0].length > 90 * sr) x = sliceAll([ref], loudestWindow(ref, sr, 90), 90, sr)[0]; // 90 s bastam para o equilíbrio
  try {
    const s = await separateStems(x, sr);
    return { vocals: s.vocals, drums: s.drums, bass: s.bass, other: s.other, sr };
  } catch (e) {
    if (e instanceof StemsUnavailable) return null;
    throw e;
  }
}

// ------------------------------------------------------------------ Mix & Master IA

async function mixIa(p: Record<string, unknown>, media: DecodedMedia[], ctx: PremiumCtx, onProgress: (v: number) => void): Promise<PremiumResult> {
  const tracksMeta = p.tracks as MixTrack[];
  const hasRef = p.has_reference === true;
  const preview = p.preview === true;
  const trackMedia = media.slice(0, tracksMeta.length);
  const sr = trackMedia[0].sampleRate;
  let audios = trackMedia.map((m) => (m.sampleRate === sr ? m.channels : toRate(m.channels, m.sampleRate, sr)));
  const n = Math.max(...audios.map((a) => a[0].length));
  audios = audios.map((a) => fit(a, n));
  const rough = roughMix(audios, n);
  if (preview) {
    const start = previewWindow(rough, sr);
    audios = sliceAll(audios, start, CLIP_SECONDS, sr);
  }
  const refMedia = hasRef ? media[tracksMeta.length] : null;
  const ref = refMedia ? (refMedia.sampleRate === sr ? refMedia.channels : toRate(refMedia.channels, refMedia.sampleRate, sr)) : null;
  onProgress(0.1);
  const reference = ref ? await referenceStems(ref, sr, preview) : null;
  onProgress(0.3);
  const key = detectKey(roughMix(audios, audios[0][0].length), sr);
  const input: EngineTrack[] = audios.map((a, i) => ({ audio: a, sr, user: tracksMeta[i] }));
  const r = mixSession(input, {
    genre: asGenre(p.genre),
    align: p.align === true,
    refAmount: Number(p.ref_amount ?? 0.6),
    reference,
    masterChain: (p.master_chain as ChainDoc | null) ?? null,
    targetLufs: Number(p.target_lufs ?? -14),
    scale: key ? scaleOf(key.tonic, key.mode) : undefined,
  });
  onProgress(0.8);
  const fmt = (p.format as OutFile["format"]) ?? "wav";
  const files: OutFile[] = [];
  const nn = (i: number) => String(i + 1).padStart(2, "0");
  if (preview) {
    files.push({ name: "previa-mix.mp3", channels: r.master, sampleRate: r.sr, format: "mp3" });
  } else {
    files.push({ name: `mix-master.${EXT[fmt]}`, channels: r.master, sampleRate: r.sr, format: fmt });
    files.push({ name: "mix-pre-master.wav", channels: r.premaster, sampleRate: r.sr, format: "wav24" });
    files.push({ name: `instrumental.${EXT[fmt]}`, channels: r.instrumental, sampleRate: r.sr, format: fmt });
    files.push({ name: `a-capella.${EXT[fmt]}`, channels: r.acapella, sampleRate: r.sr, format: fmt });
    r.stems.forEach((s, i) => files.push({ name: `pista-${nn(i)}-${slug(tracksMeta[i].name)}.flac`, channels: s, sampleRate: r.sr, format: "flac", zip: true }));
  }
  // pistas para o mixer do app (tocam no navegador com volume, pan e mudo em tempo real)
  r.stems.forEach((s, i) => files.push({ name: `mixer-${nn(i)}.m4a`, channels: s, sampleRate: r.sr, format: "m4a" }));
  const before = preview ? roughMix(audios, audios[0][0].length) : rough;
  files.push(...clips(before, r.master, r.sr));
  return {
    files,
    measures: { decisoes: r.decisions, relatorio: r.report, tom: key?.label ?? null, referencia_separada: Boolean(reference) },
    zip: preview ? undefined : "pistas-mixadas.zip",
    apiUsd: 0,
  };
}

// ------------------------------------------------------------------ Produção da composição

/** Melodia da voz da guia em notas (MIDI, início, fim) para a afinação guiada na voz final. */
function melodyOf(voice: Signal, sr: number): [number, number, number][] {
  return segmentNotes(trackPitch(voice, sr))
    .slice(0, 4000)
    .map((n) => [Math.round(n.midi), Math.round(n.start * 100) / 100, Math.round(n.end * 100) / 100] as [number, number, number]);
}

/** Folha da base: tom, BPM e a progressão de acordes por trecho (PDF de uma página ou mais). */
function chordSheet(title: string, bpm: number, keyLabel: string | null, segs: ReturnType<typeof detectChords>, lyrics = ""): Uint8Array {
  const pdf = new PdfDoc();
  pdf.rect(0, 0, pdf.width, 80, [109, 40, 217]);
  pdf.text(48, 40, "Mix Pro — Folha da base", { size: 18, bold: true, color: [255, 255, 255] });
  pdf.text(48, 62, title, { size: 11, color: [235, 225, 255] });
  let y = 112;
  pdf.text(48, y, `Tom: ${keyLabel ?? "—"}    Andamento: ${Math.round(bpm)} BPM`, { size: 12, bold: true });
  y += 28;
  pdf.text(48, y, "Acordes (minuto:segundo)", { size: 11, bold: true, color: [109, 40, 217] });
  y += 20;
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  let x = 48;
  for (const s of segs) {
    if (s.chord === "N" || s.end - s.start < 0.75) continue;
    const label = `${mmss(s.start)}  ${s.chord}`;
    pdf.text(x, y, label, { size: 10 });
    x += 105;
    if (x > pdf.width - 110) {
      x = 48;
      y += 16;
      if (y > pdf.height - 60) {
        pdf.addPage();
        y = 60;
      }
    }
  }
  y += 30;
  pdf.text(48, Math.min(y, pdf.height - 50), `Progressão: ${progression(segs).slice(0, 16).map(chordPt).join(" → ")}`, { size: 9, color: [110, 110, 125] });
  if (lyrics.trim()) {
    y = Math.min(y, pdf.height - 50) + 28;
    pdf.text(48, y, "Letra", { size: 11, bold: true, color: [109, 40, 217] });
    y += 18;
    for (const raw of lyrics.split("\n")) {
      for (const line of raw.trim() ? pdf.wrap(raw, 10, pdf.width - 96) : [""]) {
        if (y > pdf.height - 60) {
          pdf.addPage();
          y = 60;
        }
        if (line) pdf.text(48, y, line, { size: 10 });
        y += 14;
      }
    }
  }
  pdf.text(48, pdf.height - 30, "Acordes detectados automaticamente na base gerada; confira de ouvido antes de tocar.", { size: 8, color: [110, 110, 125] });
  return pdf.bytes();
}

async function compose(p: Record<string, unknown>, media: DecodedMedia[], ctx: PremiumCtx, onProgress: (v: number) => void): Promise<PremiumResult> {
  if (!ctx.composer || !ctx.presign || !ctx.readKey || !ctx.putKey) throw new JobError("TOOL_UNAVAILABLE");
  const guideFull = media[0];
  const sr = guideFull.sampleRate;
  const preview = p.preview === true;
  // prévia: só o trecho mais forte de 30 s (separar a voz com IA e gerar a música inteira não cabe numa prévia)
  const guideCh: Signal = preview ? sliceAll([guideFull.channels], previewWindow(guideFull.channels, sr), CLIP_SECONDS, sr)[0] : guideFull.channels;
  const guide = { channels: guideCh, sampleRate: sr, duration: guideCh[0].length / sr };
  // voz da guia (separada quando a guia tem instrumentos) e harmonia (a parte instrumental)
  let voice = guide.channels;
  let harmony = guide.channels;
  try {
    const s = await separateStems(guide.channels, sr, (v) => onProgress(0.15 * v));
    voice = s.vocals;
    harmony = s.other;
  } catch (e) {
    if (!(e instanceof StemsUnavailable)) throw e;
  }
  const bpm = (p.bpm as number | null) ?? detectBpm(guide.channels, sr)?.bpm ?? 90;
  const key = detectKey(harmony, sr);
  const keyLabel = (p.key as string | null) ?? key?.label ?? null;
  const guideChords = detectChords(harmony, sr);
  // a melodia só serve à Voz finalizada, que parte da entrega completa
  const melody = preview ? [] : melodyOf(voice, sr);
  onProgress(0.2);

  // a voz vai para o gerador por URL temporária (WAV 44,1 kHz); as versões voltam do mesmo jeito
  const tmp = (i: number) => `out/${ctx.jobId}/${900 + i}.wav`;
  await ctx.putKey(tmp(0), await encodeWithFfmpeg(ctx.ffmpeg, voice, sr, "wav", ctx.timeoutS));
  let refKey: string | null = null;
  if (p.has_reference === true && media[1]) {
    refKey = tmp(1);
    const r = media[1];
    const clip = sliceAll([r.channels], loudestWindow(r.channels, r.sampleRate, 60), 60, r.sampleRate)[0];
    await ctx.putKey(refKey, await encodeWithFfmpeg(ctx.ffmpeg, clip, r.sampleRate, "wav", ctx.timeoutS));
  }
  const versions = Math.max(1, Math.min(5, Number(p.versions ?? 3)));
  const seed0 = Number(p.seed ?? 1);
  const durationS = guide.duration;
  let runs = 0;
  const tempoRefs = [bpm, detectBpm(guide.channels, sr)?.bpm].filter((v): v is number => typeof v === "number" && v > 0);
  const accepted: { audio: Signal; score: number; bpm: number; chords: number; seed: number }[] = [];
  // gera, confere e refaz o que não passar (até 2 rodadas extras); fica com as melhores
  for (let round = 0; round < 3 && accepted.length < versions; round++) {
    const need = versions - accepted.length + (round === 0 ? 0 : 1);
    const seeds = Array.from({ length: need }, (_, i) => seed0 + round * 100 + i);
    const keys = seeds.map((_, i) => tmp(10 + round * 10 + i));
    try {
      await ctx.composer.generate({
        guideUrl: ctx.presign("GET", tmp(0), 3600),
        referenceUrl: refKey ? ctx.presign("GET", refKey, 3600) : null,
        outputUrls: keys.map((k) => ctx.presign!("PUT", k, 3600)),
        seeds,
        genre: asGenre(p.genre),
        style: String(p.style ?? ""),
        lyrics: String(p.lyrics ?? ""),
        bpm,
        key: keyLabel,
        durationS,
      });
    } catch {
      throw new JobError("EXTERNAL_FAILED");
    }
    runs += seeds.length;
    for (const [i, k] of keys.entries()) {
      let audio: Signal;
      try {
        audio = fit(toStereo(await decodeBytes(ctx, await ctx.readKey(k), sr)), guide.channels[0].length);
      } catch {
        continue;
      }
      // controle de qualidade: andamento, harmonia e não parecer cópia da referência
      const gb = detectBpm(audio, sr)?.bpm ?? 0;
      // o detector lê 155 BPM como ~116 (3/4) tanto na guia quanto na base: compara com o andamento pedido e com a leitura da guia
      const tempoOk = tempoRefs.some((r) => [0.5, 0.75, 1, 4 / 3, 2].some((m) => Math.abs(gb / r / m - 1) < 0.04));
      const agree = chordAgreement(guideChords, detectChords(audio, sr));
      let copy = false;
      if (refKey && media[1]) copy = chordAgreement(detectChords(media[1].channels, media[1].sampleRate), detectChords(audio, sr)) > 0.85;
      const score = (tempoOk ? 0.5 : 0) + agree * 0.5;
      // só passa quem está no andamento certo: uma base fora do tempo da guia não serve para gravar a voz
      if (!copy && tempoOk && (score >= 0.6 || round === 2)) accepted.push({ audio, score, bpm: gb, chords: Math.round(agree * 100) / 100, seed: seeds[i] });
    }
    onProgress(0.2 + 0.5 * ((round + 1) / 3));
  }
  if (!accepted.length) throw new JobError("EXTERNAL_FAILED");
  accepted.sort((a, b) => b.score - a.score);
  const chosen = accepted.slice(0, versions);
  const fmt = (p.format as OutFile["format"]) ?? "wav";
  const files: OutFile[] = [];
  const title = "Sua composição";
  chosen.forEach((v, i) => {
    const out = finalizeForSocial(v.audio.map((c) => c.slice()) as Signal, sr, -14, -1);
    if (preview) {
      const s = loudestWindow(out, sr, CLIP_SECONDS);
      files.push({ name: `previa-versao-${i + 1}.m4a`, channels: cut(out, sr, s, CLIP_SECONDS), sampleRate: sr, format: "m4a" });
    } else {
      files.push({ name: `versao-${i + 1}.${EXT[fmt]}`, channels: out, sampleRate: sr, format: fmt, zip: true });
      files.push({ name: `versao-${i + 1}-folha.pdf`, bytes: chordSheet(`${title} — versão ${i + 1}`, bpm, keyLabel, detectChords(out, sr), String(p.lyrics ?? "")), ext: "pdf", zip: true });
    }
  });
  if (!preview) {
    // clique no andamento da guia (para gravar a voz em cima)
    const mono = new Float32Array(guide.channels[0].length);
    for (const c of chosen[0].audio) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / 2;
    const beats = trackBeats(mono, sr);
    const click = clickTrack(beats, mono.length, sr);
    const cl = new Float32Array(click.length);
    for (let i = 0; i < cl.length; i++) cl[i] = click[i] / 32768;
    files.push({ name: `clique-${Math.round(beats.bpm)}bpm.wav`, channels: [cl] as Signal, sampleRate: sr, format: "wav", zip: true });
  }
  files.push(...clips(guide.channels, chosen[0].audio, sr));
  for (let i = 0; i < 40; i++) await ctx.putKey(tmp(i), new Uint8Array(0)).catch(() => {});
  return {
    files,
    measures: {
      bpm: Math.round(bpm * 10) / 10,
      tom: keyLabel,
      acordes_guia: progression(guideChords).slice(0, 32),
      melodia: melody,
      versoes: chosen.map((v) => ({ semente: v.seed, nota: Math.round(v.score * 100), bpm: Math.round(v.bpm), harmonia: v.chords })),
      geracoes: runs,
    },
    zip: preview ? undefined : "producao-versoes.zip",
    apiUsd: runs * ctx.composer.usdPerRun,
  };
}

// ------------------------------------------------------------------ Voz finalizada

async function voiceFinal(p: Record<string, unknown>, media: DecodedMedia[], ctx: PremiumCtx, onProgress: (v: number) => void): Promise<PremiumResult> {
  const [vocalM, baseM] = media;
  const refM = p.has_reference === true ? media[2] : null;
  const sr = baseM.sampleRate;
  const preview = p.preview === true;
  let vocal = vocalM.sampleRate === sr ? vocalM.channels : toRate(vocalM.channels, vocalM.sampleRate, sr);
  let base = baseM.channels;
  const n = base[0].length;
  // alinha a voz gravada com a base (até ±3 s)
  const off = alignOffset(vocal, base, sr);
  if (off.confidence >= 0.35 && Math.abs(off.offsetS) > 0.005) {
    const lag = Math.round(off.offsetS * sr);
    vocal = vocal.map((c) => {
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const j = i - lag;
        if (j >= 0 && j < c.length) o[i] = c[j];
      }
      return o;
    }) as Signal;
  } else vocal = fit(vocal, n);
  if (preview) {
    const start = previewWindow(base, sr);
    [vocal, base] = sliceAll([vocal, base], start, CLIP_SECONDS, sr);
  }
  const ref = refM ? (refM.sampleRate === sr ? refM.channels : toRate(refM.channels, refM.sampleRate, sr)) : null;
  onProgress(0.15);
  const reference = ref ? await referenceStems(ref, sr, preview) : null;
  onProgress(0.35);
  const key = detectKey(base, sr);
  const track = (name: string, role: MixTrack["role"], extra: Partial<MixTrack>): MixTrack => ({ name, role, gain_db: 0, pan: null, mute: false, eq_low: 0, eq_mid: 0, eq_high: 0, comp: null, reverb: null, tune: 0, ...extra });
  const r = mixSession(
    [
      { audio: vocal, sr, user: track("Voz.wav", "lead_vocal", { tune: Number(p.tune ?? 40), gain_db: Number(p.vocal_level_db ?? 0), reverb: Number(p.reverb ?? 30) }) },
      { audio: base, sr, user: track("Base.wav", "playback", {}) },
    ],
    {
      genre: asGenre(p.genre),
      align: false,
      refAmount: Number(p.ref_amount ?? 0.6),
      reference,
      masterChain: (p.master_chain as ChainDoc | null) ?? null,
      targetLufs: Number(p.target_lufs ?? -14),
      scale: key ? scaleOf(key.tonic, key.mode) : undefined,
      melody: (p.melody as [number, number, number][] | null) ?? null,
    },
  );
  onProgress(0.85);
  const fmt = (p.format as OutFile["format"]) ?? "wav";
  const files: OutFile[] = [];
  if (preview) files.push({ name: "previa-voz-final.mp3", channels: r.master, sampleRate: r.sr, format: "mp3" });
  else {
    files.push({ name: `musica-final.${EXT[fmt]}`, channels: r.master, sampleRate: r.sr, format: fmt });
    files.push({ name: `instrumental.${EXT[fmt]}`, channels: r.instrumental, sampleRate: r.sr, format: fmt });
    files.push({ name: `voz-tratada.${EXT[fmt]}`, channels: r.acapella, sampleRate: r.sr, format: fmt });
    files.push({ name: "musica-pre-master.wav", channels: r.premaster, sampleRate: r.sr, format: "wav24" });
  }
  const before = roughMix([vocal, base], base[0].length);
  files.push(...clips(before, r.master, r.sr));
  return { files, measures: { decisoes: r.decisions, relatorio: r.report, alinhamento_s: off.confidence >= 0.35 ? off.offsetS : 0, tom: key?.label ?? null }, apiUsd: 0 };
}

export async function runPremiumAudio(tool: PremiumToolId, p: Record<string, unknown>, media: DecodedMedia[], ctx: PremiumCtx, onProgress: (v: number) => void): Promise<PremiumResult> {
  switch (tool) {
    case "stems_premium":
      return stemsPremium(p, media, ctx, onProgress);
    case "mix_ia":
      return mixIa(p, media, ctx, onProgress);
    case "compose":
      return compose(p, media, ctx, onProgress);
    case "voice_final":
      return voiceFinal(p, media, ctx, onProgress);
  }
}

/** Para os logs e o painel de custo: loudness do primeiro arquivo de áudio. */
export const firstLufs = (files: OutFile[]) => {
  const f = files.find((x) => x.channels && x.sampleRate);
  return f ? integratedLoudness(f.channels!, f.sampleRate!) : null;
};
