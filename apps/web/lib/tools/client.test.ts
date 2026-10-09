import { test } from "node:test";
import assert from "node:assert/strict";
import { runToolJob, ToolError } from "./client";

function server(steps: Record<string, unknown>[], o: { createStatus?: number; createBody?: unknown } = {}) {
  const calls: string[] = [];
  let i = 0;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/tools/jobs") return Response.json(o.createBody ?? { job_id: "T1", credits: 3, uploads: [{ url: "https://r2/a" }, { url: "https://r2/b" }] }, { status: o.createStatus ?? 200 });
    if (url.endsWith("/start") || url.endsWith("/cancel")) return Response.json({ status: "queued" });
    return Response.json(steps[Math.min(i++, steps.length - 1)]);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const xhr = (fail = false) => () => {
  const x = { status: 200, upload: {} as { onprogress?: (e: unknown) => void }, onload: () => {}, onerror: () => {}, onabort: () => {}, open() {}, abort() {}, send() {
    if (fail) return x.onerror();
    x.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
    x.onload();
  } };
  return x as unknown as XMLHttpRequest;
};
const files = [new Blob([new Uint8Array(10)]), new Blob([new Uint8Array(30)])];
const hooks = (s: ReturnType<typeof server>, extra = {}) => {
  const phases: [string, number][] = [];
  return { phases, h: { fetchFn: s.fetchFn, xhr: xhr(), sleep: async () => {}, onPhase: (l: string, p: number) => phases.push([l, p]), ...extra } };
};

test("fluxo: cria, envia os dois arquivos, inicia, acompanha e devolve os arquivos", async () => {
  const s = server([
    { status: "queued", progress: 0 },
    { status: "running", progress: 50 },
    { status: "done", progress: 100, credits: 3, outputs: [{ name: "voz-e-playback.mp3", bytes: 9, url: "https://r2/get" }], measures: { lufs: -14 }, expiresAt: "x" },
  ]);
  const { h, phases } = hooks(s);
  const r = await runToolJob("voice_playback", { durations: [1, 2] }, files, h);
  assert.equal(r.outputs[0].name, "voz-e-playback.mp3");
  assert.ok(phases.some(([l]) => l.startsWith("Enviando os arquivos (2 de 2)")));
  assert.ok(phases.some(([l]) => l === "Mixando a voz com o playback…"));
  const p = phases.map(([, v]) => v);
  assert.ok(p.every((v, i) => i === 0 || v >= p[i - 1]), "o progresso só avança");
  assert.ok(!s.calls.some((c) => c.endsWith("/cancel")));
});

test("recusa do servidor: a mensagem amigável dele chega à tela", async () => {
  const s = server([], { createStatus: 402, createBody: { error: "Você já usou a separação de faixas grátis.", code: "NEEDS_PURCHASE" } });
  await assert.rejects(runToolJob("stems", { durations: [1] }, files.slice(0, 1), hooks(s).h), (e: ToolError) => e.code === "NEEDS_PURCHASE" && /grátis/.test(e.message));
});

test("envio falhou: cancela na hora (libera os créditos) e não inicia", async () => {
  const s = server([]);
  await assert.rejects(runToolJob("voice_playback", { durations: [1, 2] }, files, hooks(s, { xhr: xhr(true) }).h), (e: ToolError) => e.code === "UPLOAD");
  assert.ok(s.calls.includes("POST /api/tools/jobs/T1/cancel"));
  assert.ok(!s.calls.some((c) => c.endsWith("/start")));
});

test("falha no processamento: mensagem do job; depois de na fila, não cancela", async () => {
  const s = server([{ status: "failed", progress: 30, errorCode: "CORRUPT_INPUT", message: "O arquivo parece estar danificado." }]);
  await assert.rejects(runToolJob("pitch_tempo", { durations: [1] }, files.slice(0, 1), hooks(s).h), (e: ToolError) => /danificado/.test(e.message));
  assert.ok(!s.calls.some((c) => c.endsWith("/cancel")));
});
