/**
 * Recursos premium no serviço (chamados pelo runTool):
 *   stems_premium  VS Premium 7 faixas (Music.AI) + "outros" = música − soma das 6 faixas
 *   mix_ia         Mix & Master IA (motor de mixagem; referência separada com o HT-Demucs local)
 *   compose        Produção da composição (MiniMax Music Cover): instrumental, voz guia, mapa da letra e clique
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
import { fft } from "@/lib/dsp/convolve";
import { detectChords } from "@/lib/mixengine/chords";
import { CLIP_SECONDS, cut, loudestWindow, matchLoudness, roughMix } from "@/lib/mixengine/clips";
import { mixSession, type EngineTrack, type ReferenceStems } from "@/lib/mixengine/engine";
import { scaleOf } from "@/lib/mixengine/pitch";
import { alignLyrics, cleanTranscript, linesFromTranscript, lyricLines, partsOf, toLrc, type MapLine } from "@/lib/mixengine/lyrics";
import { analyzeStyle, coverPrompt, GENRE_STYLE, keyPt, parseKeyLabel, sameKeyFamily, voiceOf, type StemSet, type StyleProfile } from "@/lib/mixengine/style";
import { PdfDoc } from "@/lib/report/pdf";
import { detectBpm, detectKey } from "@/lib/tools/analysis";
import { alignOffset, toRate } from "@/lib/tools/mixing";
import { clickTrack, trackBeats } from "@/lib/vs/tempo";
import type { Composer } from "./adapters/composer";
import type { LyricsService } from "./adapters/lyrics";
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
  lyrics?: LyricsService | null;
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
//
// Gerador: MiniMax Music Cover (pela WaveSpeed). Ele recebe a guia e o prompt montado pela análise (idioma e voz
// da guia, tom, andamento, estilo escolhido e o retrato sonoro da referência) e devolve a música completa com uma
// voz de IA. A voz da IA pronuncia mal, então o app a separa: o instrumental é a entrega e a voz vira a "voz guia"
// (onde e como cantar), com o mapa da letra CERTA (a da pessoa) posicionado nos tempos em que a IA canta.
//
// A prévia já gera as versões completas e as guarda no Cofre do projeto; a entrega paga parte delas (sem gerar
// de novo). Só o que dá para medir com segurança decide quais versões ficam: andamento, tom e agudos (a melodia
// separada de uma mixagem cheia tem ruído demais para ser julgada automaticamente: quem escolhe é o ouvido).

const GEN = (pid: string, name: string) => `cofre/proj/${pid}/gen/${name}`;

type Key = { tonic: number; mode: "major" | "minor" };
type GenMeta = {
  v: 1;
  bpm: number;
  key: Key | null;
  language: string;
  lyrics: string[];
  prompt: string;
  runs: number;
  versions: { file: string; bpm: number; key: Key | null }[];
};

/**
 * Andamento usado na geração: o medido na guia, na oitava mais próxima do que a pessoa informou.
 * O gerador segue a gravação de qualquer jeito; mandar um BPM que contradiz a guia (ex.: 155 numa voz cantada a 116)
 * só piora o resultado. Se a medição falhar, vale o informado. Sempre inteiro.
 */
export function resolveBpm(informed: number | null, measured: { bpm: number; confidence: number } | null): number {
  if (!measured || measured.confidence < 0.3) return Math.round(informed ?? measured?.bpm ?? 90);
  if (!informed) return Math.round(measured.bpm);
  const options = [0.5, 1, 2].map((m) => measured.bpm * m);
  const best = options.reduce((a, b) => (Math.abs(b / informed - 1) < Math.abs(a / informed - 1) ? b : a));
  return Math.round(Math.abs(best / informed - 1) < 0.06 ? informed : best);
}

/** Frequência abaixo da qual fica 99,5% da energia (média de trechos de ~93 ms): mede se a base tem agudos. */
export function brightness(x: Signal, sr: number): number {
  const n = 4096;
  const mono = x[0].length;
  const frames = 24;
  const acc = new Float64Array(n / 2);
  for (let f = 0; f < frames; f++) {
    const start = Math.floor(((f + 0.5) / frames) * Math.max(0, mono - n));
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (const c of x) v += c[start + i] ?? 0;
      re[i] = (v / x.length) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
  }
  let total = 0;
  for (let k = 1; k < n / 2; k++) total += acc[k];
  if (total <= 0) return 0;
  let run = 0;
  for (let k = 1; k < n / 2; k++) {
    run += acc[k];
    if (run >= total * 0.995) return (k * sr) / n;
  }
  return sr / 2;
}

/** O andamento da versão bate com o da guia (o detector às vezes lê metade, dobro ou 3/4). */
export function tempoMatches(measured: number, target: number): boolean {
  return measured > 0 && [0.5, 0.75, 1, 4 / 3, 2].some((m) => Math.abs(measured / target / m - 1) < 0.04);
}

/** Separa a voz (HT-Demucs): instrumental = bateria + baixo + resto. Sem o modelo, devolve tudo como instrumental. */
async function splitVoice(x: Signal, sr: number, onProgress?: (v: number) => void): Promise<{ inst: Signal; voice: Signal | null }> {
  try {
    const s = await separateStems(x, sr, onProgress);
    const n = x[0].length;
    const inst = [0, 1].map((ch) => {
      const o = new Float32Array(n);
      for (const k of ["drums", "bass", "other"] as const) {
        const c = s[k][ch] ?? s[k][0];
        for (let i = 0; i < n; i++) o[i] += c[i] ?? 0;
      }
      return o;
    }) as Signal;
    return { inst, voice: toStereo(s.vocals) };
  } catch (e) {
    if (e instanceof StemsUnavailable) return { inst: x, voice: null };
    throw e;
  }
}

const monoOf = (x: Signal) => {
  const m = new Float32Array(x[0].length);
  for (const c of x) for (let i = 0; i < m.length; i++) m[i] += c[i] / x.length;
  return m;
};

/** Instrumental + voz guia baixa (−12 dB), como o cantor ouve no fone. */
const withGuide = (inst: Signal, voice: Signal | null, db = -12): Signal => {
  if (!voice) return inst;
  const g = 10 ** (db / 20);
  return inst.map((c, ch) => {
    const v = voice[ch] ?? voice[0];
    const o = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) o[i] = c[i] + g * (v[i] ?? 0);
    return o;
  }) as Signal;
};

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Mapa da música (PDF): tom, BPM, cada linha da letra com o tempo e a parte, e os acordes. */
function mapSheet(title: string, bpm: number, keyLabel: string | null, map: MapLine[], segs: ReturnType<typeof detectChords>): Uint8Array {
  const pdf = new PdfDoc();
  pdf.rect(0, 0, pdf.width, 80, [109, 40, 217]);
  pdf.text(48, 40, "Mix Pro — Mapa da música", { size: 18, bold: true, color: [255, 255, 255] });
  pdf.text(48, 62, title, { size: 11, color: [235, 225, 255] });
  let y = 112;
  pdf.text(48, y, `Tom: ${keyLabel ?? "—"}    Andamento: ${Math.round(bpm)} BPM`, { size: 12, bold: true });
  y += 26;
  const put = (text: string, opts: { size: number; bold?: boolean; color?: [number, number, number] }, x = 48) => {
    if (y > pdf.height - 60) {
      pdf.addPage();
      y = 60;
    }
    pdf.text(x, y, text, opts);
  };
  if (map.length) {
    put("Letra no tempo (minuto:segundo)", { size: 11, bold: true, color: [109, 40, 217] });
    y += 20;
    let part = "";
    for (const l of map) {
      if (l.part !== part) {
        part = l.part;
        y += 4;
        put(part.toUpperCase(), { size: 8, bold: true, color: [140, 120, 190] });
        y += 13;
      }
      put(l.start === null ? "—" : mmss(l.start), { size: 10, bold: true, color: [109, 40, 217] });
      for (const w of pdf.wrap(l.line, 10, pdf.width - 150)) {
        put(w, { size: 10 }, 100);
        y += 14;
      }
    }
    y += 16;
  }
  put("Acordes (minuto:segundo)", { size: 11, bold: true, color: [109, 40, 217] });
  y += 20;
  let x = 48;
  for (const s of segs) {
    if (s.chord === "N" || s.end - s.start < 0.75) continue;
    put(`${mmss(s.start)}  ${s.chord}`, { size: 10 }, x);
    x += 105;
    if (x > pdf.width - 110) {
      x = 48;
      y += 16;
    }
  }
  pdf.text(48, pdf.height - 30, "Tempos e acordes detectados automaticamente; confira de ouvido. A voz guia mostra onde e como cantar.", { size: 8, color: [110, 110, 125] });
  return pdf.bytes();
}

/** Gera as versões (prévia, ou entrega sem prévia guardada) e guarda no Cofre do projeto. */
async function generateVersions(p: Record<string, unknown>, media: DecodedMedia[], ctx: PremiumCtx, pid: string, onProgress: (v: number) => void): Promise<{ meta: GenMeta; audios: Signal[] }> {
  const composer = ctx.composer!;
  const guide = media[0];
  const sr = guide.sampleRate;
  // guia: voz (registro) e harmonia (tom)
  let voice = guide.channels;
  let harmony = guide.channels;
  try {
    const s = await separateStems(guide.channels, sr, (v) => onProgress(0.2 * v));
    voice = s.vocals;
    harmony = s.other;
  } catch (e) {
    if (!(e instanceof StemsUnavailable)) throw e;
  }
  const bpm = resolveBpm(p.bpm as number | null, detectBpm(guide.channels, sr));
  const detected = detectKey(harmony, sr);
  const key: Key | null = parseKeyLabel(p.key as string | null) ?? (detected ? { tonic: detected.tonic, mode: detected.mode } : null);
  const register = voiceOf(voice, sr)?.register ?? null;
  onProgress(0.22);

  // a guia inteira (voz + instrumento) vai ao gerador e ao Whisper por URL temporária (MP3)
  const gKey = `out/${ctx.jobId}/990.mp3`;
  await ctx.putKey!(gKey, await encodeWithFfmpeg(ctx.ffmpeg, guide.channels, sr, "mp3", ctx.timeoutS));
  // links do R2 valem no máximo 1 h: um novo a cada uso (as rodadas de geração podem passar disso)
  const gUrl = () => ctx.presign!("GET", gKey, 3600);
  let language = "pt";
  let lyrics = lyricLines(String(p.lyrics ?? ""));
  if (ctx.lyrics) {
    try {
      const t = await ctx.lyrics.transcribe(gUrl(), null);
      if (t.probability >= 0.5 && /^[a-z]{2}$/.test(t.language)) language = t.language;
      if (!lyrics.length) lyrics = linesFromTranscript(t.segments);
    } catch {
      // sem a transcrição: português e só a letra que a pessoa escreveu
    }
  }
  onProgress(0.3);

  // referência: o retrato sonoro vira texto (ela nunca vai ao gerador)
  let reference: StyleProfile | null = null;
  if (p.has_reference === true && media[1]) {
    const r = media[1];
    const clip = r.channels[0].length > 90 * r.sampleRate ? sliceAll([r.channels], loudestWindow(r.channels, r.sampleRate, 90), 90, r.sampleRate)[0] : r.channels;
    let stems: StemSet | null = null;
    try {
      stems = await separateStems(clip, r.sampleRate);
    } catch (e) {
      if (!(e instanceof StemsUnavailable)) throw e;
    }
    reference = analyzeStyle(clip, r.sampleRate, stems);
  }
  onProgress(0.36);

  const prompt = coverPrompt({ genre: GENRE_STYLE[asGenre(p.genre)] ?? GENRE_STYLE.pop, userStyle: String(p.style ?? ""), language, register, bpm, key, reference });
  const want = Math.max(1, Math.min(5, Number(p.versions ?? 3)));
  const accepted: { file: string; bpm: number; key: Key | null; audio: Signal }[] = [];
  const spare: typeof accepted = [];
  let runs = 0;
  let saved = 0;
  // gera em paralelo; o que vier abafado, fora do andamento ou em outro tom é refeito (até 2 rodadas extras)
  for (let round = 0; round < 3 && accepted.length < want; round++) {
    const need = want - accepted.length;
    const results = await Promise.allSettled(Array.from({ length: need }, () => composer.cover({ audioUrl: gUrl(), prompt })));
    runs += need;
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      let audio: Signal;
      try {
        audio = toStereo(await decodeBytes(ctx, r.value, sr));
      } catch {
        continue;
      }
      if (brightness(audio, sr) < 4000) continue;
      const gb = detectBpm(audio, sr)?.bpm ?? 0;
      if (!tempoMatches(gb, bpm)) continue;
      const gk = detectKey(audio, sr);
      const vKey: Key | null = gk ? { tonic: gk.tonic, mode: gk.mode } : null;
      const file = `${saved++}.mp3`;
      await ctx.putKey!(GEN(pid, file), r.value);
      const item = { file, bpm: Math.round(gb), key: vKey, audio };
      if (key && vKey && !sameKeyFamily(key, vKey)) spare.push(item);
      else accepted.push(item);
    }
    onProgress(0.36 + 0.34 * ((round + 1) / 3));
  }
  // em outro tom é melhor do que nada (o cantor ainda escolhe de ouvido), mas só para completar
  while (accepted.length < want && spare.length) accepted.push(spare.shift()!);
  await ctx.putKey!(gKey, new Uint8Array(0)).catch(() => {});
  if (!accepted.length) throw new JobError("EXTERNAL_FAILED");
  const meta: GenMeta = { v: 1, bpm, key, language, lyrics, prompt, runs, versions: accepted.map(({ file, bpm: b, key: k }) => ({ file, bpm: b, key: k })) };
  await ctx.putKey!(GEN(pid, "meta.json"), new TextEncoder().encode(JSON.stringify(meta)));
  return { meta, audios: accepted.map((a) => a.audio) };
}

async function readMeta(ctx: PremiumCtx, pid: string): Promise<GenMeta | null> {
  try {
    const m = JSON.parse(new TextDecoder().decode(await ctx.readKey!(GEN(pid, "meta.json")))) as GenMeta;
    return m?.v === 1 && Array.isArray(m.versions) && m.versions.length ? m : null;
  } catch {
    return null;
  }
}

async function compose(p: Record<string, unknown>, media: DecodedMedia[], ctx: PremiumCtx, onProgress: (v: number) => void): Promise<PremiumResult> {
  if (!ctx.composer || !ctx.presign || !ctx.readKey || !ctx.putKey) throw new JobError("TOOL_UNAVAILABLE");
  const pid = String(p.project_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(pid)) throw new JobError("INVALID_JOB");
  const guide = media[0];
  const sr = guide.sampleRate;
  const preview = p.preview === true;
  // a entrega parte das versões que a prévia guardou (a pessoa pagou pelo que ouviu); sem elas, gera agora
  let meta = preview ? null : await readMeta(ctx, pid);
  let audios: Signal[] | null = null;
  let runs = 0;
  if (!meta) {
    const g = await generateVersions(p, media, ctx, pid, (v) => onProgress(preview ? v * 0.85 : v * 0.5));
    meta = g.meta;
    audios = g.audios;
    runs = meta.runs;
  }
  const keyLabel = (k: Key | null) => (k ? keyPt(k) : null);
  const files: OutFile[] = [];

  if (preview) {
    // 30 s de cada versão: o instrumental e o instrumental com a voz guia
    const versoes: Record<string, unknown>[] = [];
    let firstInst: Signal | null = null;
    for (const [i, audio] of audios!.entries()) {
      const win = cut(audio, sr, loudestWindow(audio, sr, CLIP_SECONDS), CLIP_SECONDS);
      const { inst, voice } = await splitVoice(win, sr);
      const out = finalizeForSocial(inst.map((c) => c.slice()) as Signal, sr, -14, -1);
      files.push({ name: `previa-versao-${i + 1}.m4a`, channels: out, sampleRate: sr, format: "m4a" });
      if (voice) files.push({ name: `previa-versao-${i + 1}-guia.m4a`, channels: finalizeForSocial(withGuide(inst, voice), sr, -14, -1), sampleRate: sr, format: "m4a" });
      firstInst ??= out;
      versoes.push({ bpm: meta.versions[i].bpm || meta.bpm, tom: keyLabel(meta.versions[i].key) });
      onProgress(0.85 + 0.15 * ((i + 1) / audios!.length));
    }
    files.push(...clips(guide.channels, firstInst!, sr));
    return {
      files,
      measures: { bpm: meta.bpm, tom: keyLabel(meta.key), idioma: meta.language, letra: meta.lyrics.slice(0, 80), versoes, geracoes: runs },
      apiUsd: runs * ctx.composer.usdPerRun,
    };
  }

  // entrega: cada versão vira instrumental, voz guia, mapa, letra com tempo e clique
  const written = lyricLines(String(p.lyrics ?? ""));
  const lines = written.length ? written : meta.lyrics;
  const parts = partsOf(lines);
  const fmt = (p.format as OutFile["format"]) ?? "wav";
  const versoes: Record<string, unknown>[] = [];
  let firstInst: Signal | null = null;
  const total = meta.versions.length;
  const base = audios ? 0.5 : 0;
  for (const [i, v] of meta.versions.entries()) {
    const step = (x: number) => onProgress(base + (1 - base) * ((i + x) / total));
    const audio = audios?.[i] ?? toStereo(await decodeBytes(ctx, await ctx.readKey(GEN(pid, v.file)), sr));
    const { inst, voice } = await splitVoice(audio, sr, (x) => step(0.6 * x));
    const beats = trackBeats(monoOf(inst), sr);
    const bpm = Math.round(beats.bpm || v.bpm || meta.bpm);
    const k = detectKey(inst, sr);
    const tom = k ? keyPt({ tonic: k.tonic, mode: k.mode }) : keyLabel(v.key);
    // mapa: a letra certa nos tempos em que a voz guia canta
    let map: MapLine[] = lines.map((line, j) => ({ line, part: parts[j], start: null, end: null }));
    if (voice && lines.length && ctx.lyrics) {
      const vKey = `out/${ctx.jobId}/${991 + i}.mp3`;
      try {
        await ctx.putKey(vKey, await encodeWithFfmpeg(ctx.ffmpeg, voice, sr, "mp3", ctx.timeoutS));
        const t = await ctx.lyrics.transcribe(ctx.presign("GET", vKey, 3600), meta.language);
        map = alignLyrics(lines, cleanTranscript(t.segments).flatMap((s) => s.words ?? []));
      } catch {
        // sem os tempos: a letra sai na ordem, sem minutagem
      } finally {
        await ctx.putKey(vKey, new Uint8Array(0)).catch(() => {});
      }
    }
    step(0.85);
    const n = `versao-${i + 1}`;
    const instOut = finalizeForSocial(inst.map((c) => c.slice()) as Signal, sr, -14, -1);
    firstInst ??= instOut;
    files.push({ name: `${n}-instrumental.${EXT[fmt]}`, channels: instOut, sampleRate: sr, format: fmt, zip: true });
    if (voice) files.push({ name: `${n}-voz-guia.mp3`, channels: voice, sampleRate: sr, format: "mp3", zip: true });
    files.push({ name: `${n}-mapa.pdf`, bytes: mapSheet(`Sua composição — versão ${i + 1}`, bpm, tom, map, detectChords(inst, sr)), ext: "pdf", zip: true });
    if (map.some((l) => l.start !== null)) files.push({ name: `${n}-letra.lrc`, bytes: new TextEncoder().encode(toLrc(map, { title: `Versão ${i + 1}`, bpm, key: tom })), ext: "json", zip: true }); // a chave usa .json (lista fixa de extensões no banco); o download sai como .lrc
    const click = clickTrack(beats, inst[0].length, sr);
    const cl = new Float32Array(click.length);
    for (let j = 0; j < cl.length; j++) cl[j] = click[j] / 32768;
    files.push({ name: `${n}-clique-${bpm}bpm.wav`, channels: [cl] as Signal, sampleRate: sr, format: "wav", zip: true });
    // para a gravação no app (tocam juntos no navegador)
    files.push({ name: `play-inst-${i + 1}.m4a`, channels: instOut, sampleRate: sr, format: "m4a" });
    if (voice) files.push({ name: `play-guia-${i + 1}.m4a`, channels: finalizeForSocial(voice.map((c) => c.slice()) as Signal, sr, -16, -1), sampleRate: sr, format: "m4a" });
    versoes.push({ bpm, tom, mapa: map.map((l) => ({ t: l.start, linha: l.line, parte: l.part })) });
    step(1);
  }
  files.push(...clips(guide.channels, firstInst!, sr));
  return {
    files,
    measures: { bpm: meta.bpm, tom: keyLabel(meta.key), idioma: meta.language, letra: lines.slice(0, 80), versoes, geracoes: runs },
    zip: "producao-versoes.zip",
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
