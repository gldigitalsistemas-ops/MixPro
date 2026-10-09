/**
 * Ferramentas de ponta a ponta no serviço (pasta local + banco em memória + FFmpeg real). Precisa de
 * FFmpeg (FFMPEG_PATH/FFPROBE_PATH); sem ele é pulado, exceto com REQUIRE_FFMPEG=1 (CI).
 */
(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeMedia } from "@/lib/export/ffmpeg-decode";
import { integratedLoudness } from "@/lib/dsp/loudness";
import { LocalStorage } from "../src/adapters/storage";
import { MemoryToolStore, type ToolRecord } from "../src/adapters/tool-store";
import { runTool, type ToolDeps } from "../src/tools";
import { DEFAULT_LIMITS } from "../src/pipeline";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const available = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;
if (!available && process.env.REQUIRE_FFMPEG === "1") throw new Error("FFmpeg/ffprobe não encontrados (REQUIRE_FFMPEG=1)");
const skip = available ? false : "FFmpeg não encontrado";

let dir = "";
let storage: LocalStorage;
let store: MemoryToolStore;
let deps: ToolDeps;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "mixpro-tools-"));
  storage = new LocalStorage(join(dir, "armazenamento"));
  store = new MemoryToolStore();
  deps = { storage, tools: store, ffmpeg: FFMPEG, ffprobe: FFPROBE, limits: { ...DEFAULT_LIMITS, maxAttempts: 1 } };
});
after(() => dir && rmSync(dir, { recursive: true, force: true }));

/** Gera um arquivo com o FFmpeg (lavfi) e envia ao armazenamento como entrada. */
async function input(lavfi: string[], ext = "wav", extra: string[] = []): Promise<string> {
  const f = join(dir, `${randomUUID()}.${ext}`);
  assert.equal(spawnSync(FFMPEG, ["-v", "error", "-y", ...lavfi, ...extra, f]).status, 0, "gerar entrada");
  const key = `in/${randomUUID()}`;
  await storage.put(key, new Uint8Array(readFileSync(f)));
  return key;
}
const sine = (hz: number, s: number, extra: string[] = []) => ["-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${s}:sample_rate=44100`, ...extra];

function job(tool: string, params: Record<string, unknown>, inputs: string[], credits = 2): string {
  const id = randomUUID();
  const rec: ToolRecord = { id, user_id: "u", tool, status: "queued", params, inputs, credits, credit_state: credits ? "reserved" : "none", attempts: 0, expires_at: new Date(Date.now() + 86_400_000).toISOString() };
  store.jobs.set(id, rec);
  return id;
}

async function output(id: string, i = 0) {
  const o = store.jobs.get(id)!.outputs![i];
  const f = join(dir, "armazenamento", o.key);
  return { o, file: f, media: o.name.endsWith(".zip") ? null : await decodeMedia(f, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 900 }) };
}

/** Frequência dominante (cruzamentos por zero, suficiente para um seno). */
function freqOf(x: Float32Array, sr: number) {
  let z = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) z++;
  return (z * sr) / x.length;
}

test("tom: +2 semitons sobe 440 Hz para ~494 Hz e mantém a duração", { skip }, async () => {
  const id = job("pitch_tempo", { semitones: 2, tempo: 1, format: "wav", durations: [6] }, [await input(sine(440, 6))]);
  const r = await runTool(id, deps);
  assert.equal(r.status, "done", JSON.stringify(r));
  const { media, o } = await output(id);
  assert.match(o.name, /\+2st_100pct\.wav$/);
  assert.ok(Math.abs(freqOf(media!.channels[0].subarray(44100, 44100 * 5), media!.sampleRate) - 493.9) < 6);
  assert.ok(Math.abs(media!.duration - 6) < 0.15, `${media!.duration}`);
  assert.equal(store.jobs.get(id)!.credit_state, "charged");
});

test("andamento: 80% deixa a música 25% mais longa, sem mudar o tom", { skip }, async () => {
  const id = job("pitch_tempo", { semitones: 0, tempo: 0.8, format: "mp3", durations: [6] }, [await input(sine(440, 6))]);
  assert.equal((await runTool(id, deps)).status, "done");
  const { media } = await output(id);
  assert.ok(Math.abs(media!.duration - 7.5) < 0.2, `${media!.duration}`);
  assert.ok(Math.abs(freqOf(media!.channels[0].subarray(44100, 44100 * 6), media!.sampleRate) - 440) < 6);
});

test("voz + playback: uma mix no volume do destino", { skip }, async () => {
  const voice = await input(["-f", "lavfi", "-i", "sine=frequency=220:duration=8:sample_rate=48000", "-af", "volume='if(lt(mod(t,0.5),0.3),1,0)':eval=frame"]);
  const pb = await input(["-f", "lavfi", "-i", "anoisesrc=d=10:c=pink:r=44100:a=0.1"]);
  const id = job("voice_playback", { offset_s: null, voice_level_db: 0, reverb: 20, delivery: "social", format: "wav", durations: [8, 10] }, [voice, pb], 3);
  assert.equal((await runTool(id, deps)).status, "done");
  const { media } = await output(id);
  assert.equal(media!.channels.length, 2);
  assert.ok(Math.abs(integratedLoudness(media!.channels, media!.sampleRate) + 14) < 1.2);
});

test("referência + álbum (com ZIP) + formatos 24 bits e FLAC", { skip }, async () => {
  const a = await input(sine(300, 6));
  const b = await input(["-f", "lavfi", "-i", "anoisesrc=d=6:c=white:r=44100:a=0.2"]);
  const ref = job("reference_master", { amount: 0.7, format: "wav24", durations: [6, 6] }, [a, b], 3);
  assert.equal((await runTool(ref, deps)).status, "done");
  const probe = spawnSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_name,bits_per_sample", "-of", "csv=p=0", (await output(ref)).file]).stdout.toString().trim();
  assert.equal(probe, "pcm_s24le,24");

  const album = job("album", { amount: 0.5, delivery: "podcast", format: "flac", durations: [6, 6] }, [await input(sine(200, 6)), await input(sine(800, 6))], 4);
  assert.equal((await runTool(album, deps)).status, "done");
  const outs = store.jobs.get(album)!.outputs!;
  assert.deepEqual(outs.map((o) => o.name), ["faixa-01.flac", "faixa-02.flac", "album-masterizado.zip"]);
  for (const i of [0, 1]) {
    const { media } = await output(album, i);
    assert.ok(Math.abs(integratedLoudness(media!.channels, media!.sampleRate) + 16) < 1.5);
  }
});

test("conversão: WMA (que o navegador não abre) vira FLAC, sem cobrar", { skip }, async () => {
  const wma = await input(sine(440, 4), "wma", ["-c:a", "wmav2", "-b:a", "128k"]);
  const id = job("convert", { format: "flac", durations: [4] }, [wma], 0);
  assert.equal((await runTool(id, deps)).status, "done");
  const { media, o } = await output(id);
  assert.equal(o.name, "convertido.flac");
  assert.ok(Math.abs(media!.duration - 4) < 0.1);
  assert.equal(store.jobs.get(id)!.credit_state, "none");
});

test("arquivo mais longo que o declarado (o preço depende da duração) é recusado, sem cobrar", { skip }, async () => {
  const id = job("pitch_tempo", { semitones: 1, tempo: 1, format: "mp3", durations: [3] }, [await input(sine(440, 8))]);
  const r = await runTool(id, deps);
  assert.deepEqual([r.status, r.error_code], ["failed", "DURATION_MISMATCH"]);
  assert.equal(store.jobs.get(id)!.credit_state, "released");
});

test("parâmetros adulterados e entrada ausente são recusados sem gravar nada", { skip }, async () => {
  const bad = job("pitch_tempo", { semitones: 40, tempo: 1, format: "mp3", durations: [3] }, [await input(sine(440, 3))]);
  assert.equal((await runTool(bad, deps)).error_code, "INVALID_JOB");
  const missing = job("convert", { format: "wav", durations: [3] }, [`in/${randomUUID()}`], 0);
  assert.equal((await runTool(missing, deps)).error_code, "INPUT_MISSING");
  assert.equal(store.jobs.get(bad)!.outputs, undefined);
});
