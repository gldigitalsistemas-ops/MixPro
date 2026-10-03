import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { ChainDoc } from "@/lib/dsp/chain";
import { DEFAULT_LOOK } from "@/lib/media/color";
import { needsRender, type Look, type VideoFormat } from "@/lib/media/compose";
import { buildExportJob, type ExportState } from "./build-job";
import { lookOf, rendersVideo } from "./execute-job";

const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync(join(fileURLToPath(new URL("./fixtures", import.meta.url)), "chains.json"), "utf8"));

function state(look: Look, o: { kind?: "video" | "audio"; cutting?: boolean; comparing?: boolean } = {}): ExportState {
  const ch = new Float32Array(4800);
  return {
    target: "video",
    media: { file: { name: "v.mp4", size: 1, lastModified: 1 }, kind: o.kind ?? "video", videoContainer: "mp4", sampleRate: 48000, channels: [ch, ch], audioStart: 0, duration: 10 },
    preset: { slug: "criador-youtuber", versionId: null },
    chainParts: { base: CHAINS["criador-youtuber"], drums: null, reverb: null, master: null },
    customizing: false,
    intensity: 75,
    denoise: 0,
    social: true,
    cutLevel: o.cutting ? "suave" : "off",
    segments: o.cutting ? [{ start: 0, end: 3 }, { start: 4, end: 10 }] : [{ start: 0, end: 10 }],
    cutting: o.cutting ?? false,
    look,
    comparing: o.comparing ?? false,
    audiogram: null,
    music: null,
    library: { drums: [], irs: [] },
    buildId: "t",
  };
}

const plain: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial, sans-serif", color: null, cta: null };
const captions = {
  captions: [{ start: 0.5, end: 1.2, words: [{ text: "Olá", start: 0.5, end: 1.2 }] }],
  style: "karaoke" as const,
  position: "bottom" as const,
  fontFamily: "Arial, sans-serif",
};
const LOOKS: Look[] = [
  plain,
  ...(["9:16", "1:1", "4:5", "16:9"] as VideoFormat[]).map((format) => ({ ...plain, format })),
  { ...plain, fit: "crop" },
  { ...plain, watermark: true },
  { ...plain, captions },
  { ...plain, color: DEFAULT_LOOK },
  { ...plain, color: { ...DEFAULT_LOOK, auto: false, sharpen: 0 } },
  { ...plain, color: { ...DEFAULT_LOOK, auto: false, sharpen: 0, filter: "cinema", amount: 40 } },
  { ...plain, cta: { text: "Siga", handle: "@p", start: 6.5, end: 10 } },
  { ...plain, cta: { text: "   ", handle: "@p", start: 6.5, end: 10 } },
];

test("lookOf(job) devolve o mesmo Look que o estúdio passava ao render", () => {
  for (const look of LOOKS) {
    const job = buildExportJob(state(look));
    assert.deepEqual(lookOf(job), look);
  }
});

test("rendersVideo(job) == a decisão antiga (audiograma || antes→depois || needsRender) == output.render", () => {
  for (const look of LOOKS)
    for (const kind of ["video", "audio"] as const)
      for (const cutting of [false, true])
        for (const comparing of [false, true]) {
          const job = buildExportJob(state(look, { kind, cutting, comparing }));
          const old = kind === "audio" || comparing || needsRender(look, cutting);
          assert.equal(rendersVideo(job), old, JSON.stringify({ look, kind, cutting, comparing }));
          assert.equal(job.output.render, old);
        }
});
