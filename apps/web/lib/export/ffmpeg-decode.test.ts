/**
 * Decodificação do SERVIDOR (FFmpeg) contra a referência do APP (Chrome + lib/media/load.ts),
 * gravada por `scripts/parity-decode.ts --gravar-referencia` em fixtures/decode-reference.json.
 * Roda no CI sem Chrome. Usa só arquivos sintéticos e do repositório (nunca mídia pessoal).
 *
 * - PCM (WAV): impressão digital EXATA (conversão inteiro → float é determinística).
 * - Com perda (AAC/MP3): mesmos amostras, canais, taxa e início; LUFS ±0,01 dB e pico ±1e-4. O
 *   decodificador do FFmpeg pode mudar um pouco entre versões/processadores (no Windows o resíduo
 *   medido contra o Chrome foi 0 no AAC e 121–123 dB no MP3).
 * Sem FFmpeg na máquina o teste é pulado; no CI (REQUIRE_FFMPEG=1) ele é obrigatório.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { decodeMedia, DecodeError } from "./ffmpeg-decode";
import { SYNTH_WAVS, synthWav } from "./synth-wav";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const available = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;
if (!available && process.env.REQUIRE_FFMPEG === "1") throw new Error("FFmpeg/ffprobe não encontrados (REQUIRE_FFMPEG=1)");

type Ref = { erro?: string; tipo?: string; taxa?: number; canais?: number; amostras?: number; audio_start?: number; sha256_f32?: string; lufs?: number; pico?: number };
const REF: Record<string, Ref> = JSON.parse(readFileSync(join(WEB, "lib/export/fixtures/decode-reference.json"), "utf8")).arquivos;

const sha = (x: Signal) => {
  const h = createHash("sha256");
  for (const c of x) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
  return h.digest("hex");
};

test("decodificação do servidor = referência do app (sintéticos e arquivos do repositório)", { skip: available ? false : "FFmpeg não encontrado" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "mixpro-decode-"));
  try {
    for (const s of SYNTH_WAVS) writeFileSync(join(dir, s.name), synthWav(s));
    for (const [key, ref] of Object.entries(REF)) {
      const path = key.startsWith("synth:") ? join(dir, key.slice(6)) : join(WEB, key);
      assert.ok(existsSync(path), `arquivo de referência ausente: ${key}`);
      let got: Awaited<ReturnType<typeof decodeMedia>> | null = null;
      let err: string | null = null;
      try {
        got = await decodeMedia(path, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: 15 * 60 });
      } catch (e) {
        err = e instanceof DecodeError ? e.code : String(e);
      }
      if (ref.erro) {
        assert.equal(err, ref.erro, `${key}: o app recusa (${ref.erro})`);
        continue;
      }
      assert.equal(err, null, `${key}: o servidor recusou (${err})`);
      const g = got!;
      assert.equal(g.kind, ref.tipo, `${key}: tipo`);
      assert.equal(g.sampleRate, ref.taxa, `${key}: taxa`);
      assert.equal(g.channels.length, ref.canais, `${key}: canais`);
      assert.equal(g.channels[0].length, ref.amostras, `${key}: amostras`);
      assert.ok(Math.abs(g.audioStart - (ref.audio_start ?? 0)) <= 1 / g.sampleRate, `${key}: audio_start`);
      if (key.endsWith(".wav")) assert.equal(sha(g.channels), ref.sha256_f32, `${key}: impressão digital (PCM deve ser idêntico)`);
      else {
        assert.ok(Math.abs(integratedLoudness(g.channels, g.sampleRate) - ref.lufs!) <= 0.01, `${key}: LUFS`);
        assert.ok(Math.abs(samplePeak(g.channels) - ref.pico!) <= 1e-4, `${key}: pico`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mídia pessoal (fixtures-local) não entra na referência versionada", () => {
  for (const key of Object.keys(REF)) assert.ok(!key.includes("fixtures-local"), key);
  const raw = readFileSync(join(WEB, "lib/export/fixtures/decode-reference.json"), "utf8");
  assert.ok(raw.length < 64 * 1024, "referência pequena");
});
