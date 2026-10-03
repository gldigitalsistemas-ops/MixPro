import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { Signal } from "@/lib/dsp/types";
import type { Look } from "@/lib/media/compose";
import { processJobAudio } from "./audio-job";
import { buildExportJob, type ExportState } from "./build-job";
import { validateServerJob } from "./server-validate";

(globalThis as Record<string, unknown>).WorkerGlobalScope ??= function WorkerGlobalScope() {};

const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync(join(fileURLToPath(new URL("./fixtures", import.meta.url)), "chains.json"), "utf8"));
const SR = 48000;
const plain: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial, sans-serif", color: null, cta: null };
const CTA = { text: "Comenta qual música você quer ver na próxima 👇", handle: "@meuperfil", start: 4.5, end: 8 };

/** Fala sintética com pausas (para os cortes terem efeito). */
function speech(seconds: number): Signal {
  const x = new Float32Array(SR * seconds);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (t % 2 < 1.3) for (let h = 1; h <= 6; h++) x[i] += (0.15 / h) * Math.sin(2 * Math.PI * 160 * h * t);
  }
  return [x, x.map((v) => v * 0.9)];
}

function state(o: Partial<ExportState>): ExportState {
  const ch = speech(8);
  return {
    target: "mp3",
    media: { file: { name: "v.mp4", size: 1, lastModified: 1 }, kind: "video", videoContainer: "mp4", sampleRate: SR, channels: ch, audioStart: 0, duration: 8 },
    preset: { slug: "criador-youtuber", versionId: null },
    chainParts: { base: CHAINS["criador-youtuber"], drums: null, reverb: null, master: null },
    customizing: false,
    intensity: 75,
    denoise: 0,
    social: true,
    cutLevel: "suave",
    segments: [{ start: 0, end: 1.4 }, { start: 2, end: 3.4 }, { start: 4, end: 8 }],
    cutting: true,
    look: plain,
    comparing: false,
    audiogram: null,
    music: null,
    library: { drums: [], irs: [] },
    buildId: "t",
    ...o,
  };
}

const sha = (x: Signal) => {
  const h = createHash("sha256");
  for (const c of x) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
  return h.digest("hex");
};
const run = async (s: ExportState) => sha(await processJobAudio(buildExportJob(s), speech(8), SR));

test("CTA em alvo de áudio é inerte: mesmo sha256_f32 com e sem CTA (só o p_ref muda)", async () => {
  for (const target of ["mp3", "wav", "m4a"] as const) {
    const without = state({ target });
    const withCta = state({ target, look: { ...plain, cta: CTA } });
    const a = buildExportJob(without);
    const b = buildExportJob(withCta);
    assert.deepEqual(b.audio.chain, a.audio.chain);
    assert.deepEqual(b.cuts, a.cuts);
    assert.notEqual(b.idempotency_ref, a.idempotency_ref, "o CTA entra no p_ref (como no app)");
    assert.equal(await run(withCta), await run(without), target);
    // o servidor aceita os dois
    assert.equal(validateServerJob(JSON.stringify(b)).ok, true);
  }
});

test("antes → depois em alvo de áudio também é inerte para o som (só muda o p_ref)", async () => {
  const off = state({});
  const on = state({ comparing: true });
  assert.notEqual(buildExportJob(on).idempotency_ref, buildExportJob(off).idempotency_ref);
  assert.equal(await run(on), await run(off));
});

test("CTA: recusado em alvo de vídeo e acima dos limites da interface", () => {
  const video = state({ target: "video", cutting: false, cutLevel: "off", segments: [{ start: 0, end: 8 }], look: { ...plain, cta: CTA } });
  const r = validateServerJob(JSON.stringify(buildExportJob(video)));
  assert.equal(r.ok ? "" : r.code, "OUT_OF_SCOPE");
  for (const [cta, ok] of [
    [{ ...CTA, text: "x".repeat(70) }, true],
    [{ ...CTA, text: "x".repeat(71) }, false],
    [{ ...CTA, handle: "@" + "a".repeat(31) }, true],
    [{ ...CTA, handle: "@" + "a".repeat(32) }, false],
  ] as const) {
    const res = validateServerJob(JSON.stringify(buildExportJob(state({ look: { ...plain, cta } }))));
    assert.equal(res.ok, ok, JSON.stringify({ t: cta.text.length, h: cta.handle.length }));
    if (!res.ok) assert.equal(res.code, "LIMIT");
  }
});
