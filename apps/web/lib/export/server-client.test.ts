import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync as read } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { Look } from "@/lib/media/compose";
import { buildExportJob, type ExportState } from "./build-job";
import { prepareServerInput, runServerExport, serverEligible, ServerExportError } from "./server-client";

const CHAINS: Record<string, ChainDoc> = JSON.parse(read(join(fileURLToPath(new URL("./fixtures", import.meta.url)), "chains.json"), "utf8"));
const SR = 48000;
const plain: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial, sans-serif", color: null, cta: null };
const state = (o: Partial<ExportState> = {}): ExportState => {
  const ch = new Float32Array(SR).map((_, i) => Math.sin(i / 20) * 0.2);
  return {
    target: "mp3",
    media: { file: { name: "a.wav", size: 1234, lastModified: 1_700_000_000_000 }, kind: "audio", videoContainer: "mp4", sampleRate: SR, channels: [ch], audioStart: 0, duration: 95.5 },
    preset: { slug: "criador-youtuber", versionId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427" },
    chainParts: { base: JSON.parse(JSON.stringify(CHAINS["criador-youtuber"])), drums: null, reverb: null, master: null },
    customizing: false, intensity: 75, denoise: 0.9, social: true, cutLevel: "off", segments: [{ start: 0, end: 95.5 }], cutting: false, look: plain, comparing: false,
    audiogram: null, music: null, library: { drums: [], irs: [] }, buildId: "t", ...o,
  };
};
const job = () => buildExportJob(state());
const wav = new File([new Uint8Array(2000)], "a.wav");
const media = { file: wav, kind: "audio" as const };

type Call = { method: string; url: string };
/** Servidor falso: roteia as chamadas e devolve uma sequência de estados. */
function fakeServer(steps: Array<Record<string, unknown>>, o: { createStatus?: number; createBody?: unknown; upload?: boolean } = {}) {
  const calls: Call[] = [];
  let i = 0;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url === "/api/export/jobs") return Response.json(o.createBody ?? { job_id: "J1", outcome: "created", upload: o.upload === false ? null : { url: "https://r2.test/put" } }, { status: o.createStatus ?? 200 });
    if (url.endsWith("/start")) return Response.json({ status: "queued" });
    if (url.endsWith("/cancel")) return Response.json({ status: "failed" });
    if (url.startsWith("https://r2.test/get")) return new Response(new Uint8Array([1, 2, 3]));
    if (url === "/api/export/jobs/J1") return Response.json(steps[Math.min(i++, steps.length - 1)]);
    return new Response("?", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const fakeXhr = (status = 200, progress = [0.5, 1]) => () => {
  const x = { status, upload: {} as { onprogress?: (e: unknown) => void }, onload: () => {}, onerror: () => {}, onabort: () => {}, open() {}, abort() { x.onabort(); },
    send() { progress.forEach((p) => x.upload.onprogress?.({ lengthComputable: true, loaded: p * 100, total: 100 })); x.onload(); } };
  return x as unknown as XMLHttpRequest;
};
const noWait = async () => {};
const hooks = (extra: object = {}) => {
  const phases: [string, number][] = [];
  return { phases, h: { onPhase: (l: string, p: number) => phases.push([l, p]), sleep: noWait, xhr: fakeXhr(), ...extra } };
};

test("fluxo completo: cria, envia com progresso real, inicia, acompanha e baixa", async () => {
  const s = fakeServer([
    { status: "queued", progress: 0, error_code: null, download_url: null },
    { status: "running", progress: 40, error_code: null, download_url: null },
    { status: "done", progress: 100, error_code: null, download_url: "https://r2.test/get/out" },
  ]);
  const { h, phases } = hooks({ fetchFn: s.fetchFn });
  const blob = await runServerExport(job(), media, h);
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(s.calls.filter((c) => c.method === "POST").map((c) => c.url), ["/api/export/jobs", "/api/export/jobs/J1/start"]);
  const labels = phases.map(([l]) => l);
  for (const l of ["Enviando o áudio…", "Na fila do servidor…", "Processando no servidor…", "Baixando o resultado…"]) assert.ok(labels.includes(l), l);
  const progress = phases.map(([, p]) => p);
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]), "o progresso só avança");
  assert.ok(progress.every((p) => p >= 0 && p <= 100));
});

test("job já pronto (mesmo p_ref): não envia de novo", async () => {
  const s = fakeServer([{ status: "done", progress: 100, error_code: null, download_url: "https://r2.test/get/out" }], { upload: false });
  const { h } = hooks({ fetchFn: s.fetchFn, xhr: () => { throw new Error("não deveria enviar"); } });
  await runServerExport(job(), media, h);
});

test("recusas do servidor viram mensagem amigável e indicam se o aparelho assume", async () => {
  for (const [code, status, device] of [["INSUFFICIENT_CREDITS", 402, false], ["CAPACITY", 503, true], ["REF_MISMATCH", 409, true]] as const) {
    const s = fakeServer([], { createStatus: status, createBody: { error: "x", code, device } });
    const { h } = hooks({ fetchFn: s.fetchFn });
    await assert.rejects(runServerExport(job(), media, h), (e: ServerExportError) => e instanceof ServerExportError && e.code === code && e.device === device && !/Error|undefined/.test(e.message));
  }
});

test("falha no processamento: código fechado do job vira mensagem; erro permanente não oferece o aparelho", async () => {
  const s = fakeServer([{ status: "failed", progress: 30, error_code: "CORRUPT_INPUT", download_url: null }]);
  const { h } = hooks({ fetchFn: s.fetchFn });
  await assert.rejects(runServerExport(job(), media, h), (e: ServerExportError) => e.code === "CORRUPT_INPUT" && e.device === false && /danificado/.test(e.message));
  const s2 = fakeServer([{ status: "failed", progress: 30, error_code: "TIMEOUT", download_url: null }]);
  await assert.rejects(runServerExport(job(), media, hooks({ fetchFn: s2.fetchFn }).h), (e: ServerExportError) => e.device === true);
});

test("sem internet: o aparelho assume (CAPACITY, device)", async () => {
  const fetchFn = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await assert.rejects(runServerExport(job(), media, hooks({ fetchFn }).h), (e: ServerExportError) => e.code === "CAPACITY" && e.device);
});

test("falha de rede no envio: tenta de novo uma vez; erro do armazenamento (4xx) não repete", async () => {
  let n = 0;
  const flaky = () => {
    const x = fakeXhr()() as unknown as { send: () => void; onerror: () => void; onload: () => void; status: number; upload: object };
    const send = x.send.bind(x);
    x.send = () => (++n === 1 ? x.onerror() : send());
    return x as unknown as XMLHttpRequest;
  };
  const s = fakeServer([{ status: "done", progress: 100, error_code: null, download_url: "https://r2.test/get/out" }]);
  await runServerExport(job(), media, hooks({ fetchFn: s.fetchFn, xhr: flaky }).h);
  assert.equal(n, 2);

  const bad = fakeServer([]);
  await assert.rejects(runServerExport(job(), media, hooks({ fetchFn: bad.fetchFn, xhr: fakeXhr(403) }).h), (e: ServerExportError) => e.code === "INPUT_MISSING");
});

test("cancelar durante o acompanhamento chama /cancel e propaga AbortError", async () => {
  const ctrl = new AbortController();
  const s = fakeServer([{ status: "running", progress: 10, error_code: null, download_url: null }]);
  const { h } = hooks({ fetchFn: s.fetchFn, signal: ctrl.signal, sleep: async () => ctrl.abort() });
  await assert.rejects(runServerExport(job(), media, h), (e: Error) => e.name === "AbortError");
  assert.ok(s.calls.some((c) => c.url.endsWith("/cancel")), "a reserva é liberada");
});

test("tempo esgotado: cancela e devolve TIMEOUT (aparelho assume)", async () => {
  const s = fakeServer([{ status: "running", progress: 10, error_code: null, download_url: null }]);
  await assert.rejects(runServerExport(job(), media, hooks({ fetchFn: s.fetchFn, maxWaitMs: -1 }).h), (e: ServerExportError) => e.code === "TIMEOUT" && e.device);
  assert.ok(s.calls.some((c) => c.url.endsWith("/cancel")));
});

test("elegibilidade: áudio comum sim; com música ou com legendas não", () => {
  assert.equal(serverEligible(job()), true);
  assert.equal(serverEligible(buildExportJob(state({ music: { name: "m", level: "media", channels: [new Float32Array(SR)] } }))), false);
  const withCaptions = JSON.parse(JSON.stringify(job()));
  withCaptions.captions = { captions: [], style: "destaque", position: "bottom" };
  assert.equal(serverEligible(withCaptions), false);
});

test("arquivo grande demais é recusado antes de enviar (WAV de 41 MB)", async () => {
  const big = { file: { name: "x.wav", size: 41 * 1024 * 1024 } as File, kind: "audio" as const };
  await assert.rejects(prepareServerInput(big), (e: ServerExportError) => e.code === "TOO_LARGE" && e.device);
});

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const hasFfmpeg = (() => { try { execFileSync(FFMPEG, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const skip = hasFfmpeg ? false : process.env.REQUIRE_FFMPEG ? undefined : "sem FFmpeg";

test("vídeo: só a trilha de áudio vai ao servidor, bem menor e com o índice no começo", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "srvin-"));
  try {
    const src = join(dir, "v.mp4");
    execFileSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=25:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-b:v", "3M", "-minrate", "3M", "-maxrate", "3M", "-bufsize", "1M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
    const file = new File([readFileSync(src)], "v.mp4", { type: "video/mp4" });
    const out = await prepareServerInput({ file, kind: "video" });
    assert.ok(out.size < file.size / 3, `${out.size} deveria ser bem menor que ${file.size}`);
    const dst = join(dir, "a.mp4");
    writeFileSync(dst, Buffer.from(await out.arrayBuffer()));
    const info = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-of", "json", dst]).toString());
    assert.deepEqual(info.streams.map((s: { codec_type: string }) => s.codec_type), ["audio"]);
    // o índice (moov) vem antes dos dados (mdat): o serviço lê em fluxo
    const bytes = readFileSync(dst);
    assert.ok(bytes.indexOf("moov") < bytes.indexOf("mdat"), "moov antes de mdat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
