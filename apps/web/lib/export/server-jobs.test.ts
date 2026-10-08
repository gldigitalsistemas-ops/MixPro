import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { ChainDoc } from "@/lib/dsp/chain";
import type { Look } from "@/lib/media/compose";
import { buildExportJob, type ExportState } from "./build-job";
import { LocalQueue } from "./queue";
import { cancelJob, createJob, jobStatus, MAX_INPUT_BYTES, startJob, type Deps, type Rpc } from "./server-jobs";

const CHAINS: Record<string, ChainDoc> = JSON.parse(readFileSync(join(fileURLToPath(new URL("./fixtures", import.meta.url)), "chains.json"), "utf8"));
const SR = 48000;
const plain: Look = { format: "original", fit: "blur", watermark: false, captions: null, fontFamily: "Arial, sans-serif", color: null, cta: null };
const state = (o: Partial<ExportState> = {}): ExportState => {
  const ch = new Float32Array(SR).map((_, i) => Math.sin(i / 20) * 0.2);
  return {
    target: "mp3",
    media: { file: { name: "a.m4a", size: 1234, lastModified: 1_700_000_000_000 }, kind: "audio", videoContainer: "mp4", sampleRate: SR, channels: [ch], audioStart: 0, duration: 95.5 },
    preset: { slug: "criador-youtuber", versionId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427" },
    chainParts: { base: JSON.parse(JSON.stringify(CHAINS["criador-youtuber"])), drums: null, reverb: null, master: null },
    customizing: false, intensity: 75, denoise: 0.9, social: true, cutLevel: "off", segments: [{ start: 0, end: 95.5 }], cutting: false, look: plain, comparing: false,
    audiogram: null, music: null, library: { drums: [], irs: [] }, buildId: "t", ...o,
  };
};

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY_ID = "11111111-2222-4333-8444-555555555555";

/** Banco falso com as regras das RPCs que as rotas usam. */
function harness(opts: { rpcError?: string } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const stored = new Map<string, number>();
  const deleted: string[] = [];
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (opts.rpcError && fn === "create_export_job") return { data: null, error: { message: opts.rpcError } };
    if (fn === "create_export_job") {
      const id = `00000000-0000-4000-8000-${String(rows.size + 1).padStart(12, "0")}`;
      rows.set(id, { id, user_id: args.p_user, status: "queued", progress: 0, credit_state: "reserved", input_key: args.p_input_key, output_key: null, error_code: null });
      return { data: { job_id: id, outcome: "created", status: "queued" }, error: null };
    }
    if (fn === "get_export_job") return { data: rows.get(args.p_job_id as string) ?? null, error: null };
    if (fn === "cancel_export_job") {
      const r = rows.get(args.p_job_id as string);
      if (!r || r.user_id !== args.p_user) return { data: null, error: { message: "JOB_NOT_FOUND" } };
      r.status = "failed";
      r.error_code = "CANCELLED";
      return { data: {}, error: null };
    }
    return { data: null, error: { message: "desconhecida" } };
  };
  const queue = new LocalQueue();
  const deps: Deps = {
    rpc,
    queue,
    newId: () => KEY_ID,
    objects: {
      presign: (m, key, ttl, o) => `https://r2.test/${m}/${key}?ttl=${ttl}&len=${o?.contentLength ?? ""}`,
      head: async (k) => (stored.has(k) ? { size: stored.get(k)! } : null),
      delete: async (k) => void deleted.push(k),
    },
  };
  return { deps, rows, calls, stored, deleted, queue };
}

const body = () => JSON.stringify(buildExportJob(state()));

test("create: valida o job, reserva e devolve a URL de envio com o tamanho assinado", async () => {
  const h = harness();
  const r = await createJob(h.deps, ALICE, { body: body(), inputBytes: 5000, platform: "android/chrome" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.outcome, "created");
  assert.equal(r.upload?.url, `https://r2.test/PUT/in/${KEY_ID}?ttl=900&len=5000`);
  const c = h.calls[0].args;
  assert.equal(c.p_user, ALICE);
  assert.equal(c.p_target, "mp3");
  assert.equal(c.p_input_key, `in/${KEY_ID}`);
  assert.equal(c.p_platform, "android/chrome");
});

test("create: recusa antes de tocar no banco (job inválido, adulterado, arquivo grande ou vazio)", async () => {
  const h = harness();
  const bad = await createJob(h.deps, ALICE, { body: "{", inputBytes: 10 });
  assert.deepEqual([bad.ok, !bad.ok && bad.code], [false, "INVALID_JOB"]);
  const tampered = JSON.parse(body());
  tampered.audio.intensity = 50; // o p_ref recalculado não bate
  const t = await createJob(h.deps, ALICE, { body: JSON.stringify(tampered), inputBytes: 10 });
  assert.equal(!t.ok && t.code, "REF_INVALID");
  const big = await createJob(h.deps, ALICE, { body: body(), inputBytes: MAX_INPUT_BYTES + 1 });
  assert.equal(!big.ok && big.code, "TOO_LARGE");
  const zero = await createJob(h.deps, ALICE, { body: body(), inputBytes: 0 });
  assert.equal(!zero.ok && zero.code, "TOO_LARGE");
  assert.equal(h.calls.length, 0, "nada chegou ao banco");
});

test("create: erros do banco viram código fechado, mensagem amigável e a opção de processar no aparelho", async () => {
  for (const [code, status, device] of [["INSUFFICIENT_CREDITS", 402, false], ["RATE_LIMITED", 429, true], ["CAPACITY", 503, true]] as const) {
    const h = harness({ rpcError: `${code}: texto interno do banco` });
    const r = await createJob(h.deps, ALICE, { body: body(), inputBytes: 10 });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.deepEqual([r.code, r.status, r.device], [code, status, device]);
    assert.ok(!r.message.includes("interno"), "a mensagem não repete o texto do banco");
  }
  const h = harness({ rpcError: "algo inesperado com detalhes sensíveis" });
  const r = await createJob(h.deps, ALICE, { body: body(), inputBytes: 10 });
  assert.equal(!r.ok && r.code, "INTERNAL");
});

test("start: sem o arquivo no R2 → INPUT_MISSING; com o arquivo → enfileira uma vez", async () => {
  const h = harness();
  const c = await createJob(h.deps, ALICE, { body: body(), inputBytes: 5000 });
  assert.ok(c.ok);
  if (!c.ok) return;
  const early = await startJob(h.deps, ALICE, c.jobId);
  assert.equal(!early.ok && early.code, "INPUT_MISSING");
  assert.equal(h.queue.sizes().ready, 0);

  h.stored.set(`in/${KEY_ID}`, 5000);
  assert.ok((await startJob(h.deps, ALICE, c.jobId)).ok);
  assert.ok((await startJob(h.deps, ALICE, c.jobId)).ok);
  assert.equal(h.queue.sizes().ready, 1, "clique repetido não duplica a tarefa");
});

test("start: arquivo maior que o limite é apagado e recusado", async () => {
  const h = harness();
  const c = await createJob(h.deps, ALICE, { body: body(), inputBytes: 5000 });
  if (!c.ok) throw new Error("create falhou");
  h.stored.set(`in/${KEY_ID}`, MAX_INPUT_BYTES + 1);
  const r = await startJob(h.deps, ALICE, c.jobId);
  assert.equal(!r.ok && r.code, "TOO_LARGE");
  assert.deepEqual(h.deleted, [`in/${KEY_ID}`]);
});

test("segurança: outro usuário não vê, não inicia, não cancela e não baixa o job (resposta de 'não existe')", async () => {
  const h = harness();
  const c = await createJob(h.deps, ALICE, { body: body(), inputBytes: 5000 });
  if (!c.ok) throw new Error("create falhou");
  h.stored.set(`in/${KEY_ID}`, 5000);
  for (const op of [startJob, jobStatus, cancelJob]) {
    const r = await op(h.deps, BOB, c.jobId);
    assert.deepEqual([r.ok, !r.ok && r.status, !r.ok && r.code], [false, 404, "JOB_NOT_FOUND"]);
  }
  assert.equal(h.queue.sizes().ready, 0);
  assert.equal(h.rows.get(c.jobId)?.status, "queued");
  const notUuid = await jobStatus(h.deps, ALICE, "../../etc/passwd");
  assert.equal(!notUuid.ok && notUuid.code, "JOB_NOT_FOUND");
});

test("status: progresso real, URL de download só quando pronto, e mensagem amigável na falha", async () => {
  const h = harness();
  const c = await createJob(h.deps, ALICE, { body: body(), inputBytes: 5000 });
  if (!c.ok) throw new Error("create falhou");
  const row = h.rows.get(c.jobId)!;

  row.status = "running";
  row.progress = 42;
  const running = await jobStatus(h.deps, ALICE, c.jobId);
  assert.ok(running.ok && running.progress === 42 && running.downloadUrl === null);

  row.status = "done";
  row.output_key = "out/22222222-2222-4222-8222-222222222222.mp3";
  const done = await jobStatus(h.deps, ALICE, c.jobId);
  assert.ok(done.ok && done.downloadUrl === "https://r2.test/GET/out/22222222-2222-4222-8222-222222222222.mp3?ttl=60&len=");

  row.status = "failed";
  row.output_key = null;
  row.error_code = "CORRUPT_INPUT";
  const failed = await jobStatus(h.deps, ALICE, c.jobId);
  assert.ok(failed.ok && failed.downloadUrl === null && failed.device === false);
  assert.ok(failed.ok && /danificado/.test(failed.message ?? ""));
});

test("cancel: o dono cancela, o arquivo de entrada é apagado", async () => {
  const h = harness();
  const c = await createJob(h.deps, ALICE, { body: body(), inputBytes: 5000 });
  if (!c.ok) throw new Error("create falhou");
  assert.ok((await cancelJob(h.deps, ALICE, c.jobId)).ok);
  assert.deepEqual(h.deleted, [`in/${KEY_ID}`]);
  const s = await jobStatus(h.deps, ALICE, c.jobId);
  assert.ok(s.ok && s.errorCode === "CANCELLED");
});
