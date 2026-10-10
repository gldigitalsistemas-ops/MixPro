import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TOOL_COSTS } from "@mixpro/contracts";
import type { Rpc } from "@/lib/export/server-jobs";
import { cancelTool, createTool, startTool, toolStatus, type ToolDeps } from "./server-tools";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function harness(o: { pro?: boolean; rpcError?: string } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  const stored = new Map<string, number>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const enq: { id: string; opts: unknown }[] = [];
  const deleted: string[] = [];
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn === "create_tool_job") {
      if (o.rpcError) return { data: null, error: { message: o.rpcError } };
      const id = `00000000-0000-4000-8000-${String(rows.size + 1).padStart(12, "0")}`;
      rows.set(id, { id, user_id: args.p_user, tool: args.p_tool, status: "queued", progress: 0, inputs: args.p_inputs, outputs: null, error_code: null, credits: args.p_credits, credit_state: "reserved", measures: null, expires_at: new Date(Date.now() + 86_400_000).toISOString() });
      return { data: { job_id: id }, error: null };
    }
    if (fn === "get_tool_job") return { data: rows.get(args.p_job_id as string) ?? null, error: null };
    if (fn === "cancel_tool_job") {
      const r = rows.get(args.p_job_id as string);
      if (!r || r.user_id !== args.p_user) return { data: null, error: { message: "JOB_NOT_FOUND" } };
      r.status = "failed";
      return { data: {}, error: null };
    }
    return { data: null, error: { message: "?" } };
  };
  const d: ToolDeps = {
    rpc,
    objects: {
      presign: (m, k, ttl, opt) => `https://r2.test/${m}/${k}?ttl=${ttl}&len=${opt?.contentLength ?? ""}&name=${opt?.downloadName ?? ""}`,
      head: async (k) => (stored.has(k) ? { size: stored.get(k)! } : null),
      delete: async (k) => void deleted.push(k),
    },
    queue: {
      mode: "push",
      enqueue: async (id, opts) => {
        enq.push({ id, opts });
        return { id };
      },
      dequeue: async () => null,
      ack: async () => {},
      fail: async () => "dead",
      retry: async () => {},
    },
    costs: async () => DEFAULT_TOOL_COSTS,
    isPro: async () => Boolean(o.pro),
  };
  return { d, rows, stored, calls, enq, deleted };
}

const vp = { offset_s: null, voice_level_db: 0, reverb: 25, delivery: "social", format: "mp3", durations: [120, 125] };

test("criar: preço calculado no servidor, uma URL de envio por arquivo com o tamanho assinado", async () => {
  const h = harness();
  const r = await createTool(h.d, ALICE, { tool: "voice_playback", params: vp, inputBytes: [1000, 2000] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.credits, 3);
  assert.equal(r.retentionDays, 1);
  assert.equal(r.uploads.length, 2);
  assert.match(r.uploads[1].url, /len=2000/);
  const c = h.calls[0].args;
  assert.equal(c.p_credits, 3);
  assert.equal((c.p_inputs as string[]).length, 2);
});

test("criar: separação cobra pela duração; álbum por faixa", async () => {
  const h = harness();
  const s = await createTool(h.d, ALICE, { tool: "stems", params: { format: "wav", durations: [500] }, inputBytes: [10] });
  assert.ok(s.ok && s.credits === 5);
  const a = await createTool(h.d, ALICE, { tool: "album", params: { amount: 0.5, delivery: "social", format: "mp3", durations: [100, 100, 100] }, inputBytes: [1, 1, 1] });
  assert.ok(a.ok && a.credits === 6);
});

test("criar: WAV 24/FLAC e Cofre só no Pro", async () => {
  const free = harness();
  const r = await createTool(free.d, ALICE, { tool: "pitch_tempo", params: { semitones: 1, tempo: 1, format: "flac", durations: [100] }, inputBytes: [10] });
  assert.equal(!r.ok && r.code, "PRO_ONLY");
  assert.equal(free.calls.length, 0, "nada reservado");
  const pro = harness({ pro: true });
  const ok = await createTool(pro.d, ALICE, { tool: "pitch_tempo", params: { semitones: 1, tempo: 1, format: "flac", durations: [100] }, inputBytes: [10] });
  assert.ok(ok.ok && ok.retentionDays === 30);
  assert.equal(pro.calls[0].args.p_retention_days, 30);
});

test("criar: parâmetros adulterados, quantidade de arquivos errada e arquivo grande recusados antes do banco", async () => {
  const h = harness();
  assert.equal((await createTool(h.d, ALICE, { tool: "voice_playback", params: { ...vp, reverb: 500 }, inputBytes: [1, 1] }) as { code: string }).code, "INVALID_JOB");
  assert.equal((await createTool(h.d, ALICE, { tool: "voice_playback", params: vp, inputBytes: [1] }) as { code: string }).code, "INVALID_JOB");
  assert.equal((await createTool(h.d, ALICE, { tool: "voice_playback", params: vp, inputBytes: [1, 999 * 1024 * 1024] }) as { code: string }).code, "TOO_LARGE");
  assert.equal(h.calls.length, 0);
});

test("criar: erros do banco viram mensagens das ferramentas (sem sugerir o aparelho)", async () => {
  const h = harness({ rpcError: "NEEDS_PURCHASE" });
  const r = await createTool(h.d, ALICE, { tool: "stems", params: { format: "mp3", durations: [200] }, inputBytes: [10] });
  assert.ok(!r.ok && r.code === "NEEDS_PURCHASE" && r.status === 402);
  const h2 = harness({ rpcError: "CAPACITY" });
  const r2 = await createTool(h2.d, ALICE, { tool: "stems", params: { format: "mp3", durations: [200] }, inputBytes: [10] });
  assert.ok(!r2.ok && !/aparelho/.test(r2.message));
});

test("iniciar: exige os arquivos; separação vai para o serviço pesado e o Pro para a fila prioritária", async () => {
  const h = harness({ pro: true });
  const c = await createTool(h.d, ALICE, { tool: "stems", params: { format: "mp3", durations: [200] }, inputBytes: [10] });
  if (!c.ok) throw new Error("criar");
  assert.equal((await startTool(h.d, ALICE, c.jobId) as { code: string }).code, "INPUT_MISSING");
  const key = (h.rows.get(c.jobId)!.inputs as string[])[0];
  h.stored.set(key, 10);
  assert.ok((await startTool(h.d, ALICE, c.jobId)).ok);
  assert.deepEqual(h.enq[0], { id: c.jobId, opts: { kind: "tool", heavy: true, priority: true } });
});

test("segurança: outro usuário não vê, não inicia, não cancela e não baixa", async () => {
  const h = harness();
  const c = await createTool(h.d, ALICE, { tool: "pitch_tempo", params: { semitones: 2, tempo: 1, format: "mp3", durations: [100] }, inputBytes: [10] });
  if (!c.ok) throw new Error("criar");
  for (const op of [startTool, toolStatus, cancelTool]) {
    const r = await op(h.d, BOB, c.jobId);
    assert.ok(!r.ok && r.code === "JOB_NOT_FOUND" && r.status === 404);
  }
  assert.equal(h.enq.length, 0);
});

test("status: arquivos só quando pronto e dentro do prazo, com nome para download", async () => {
  const h = harness();
  const c = await createTool(h.d, ALICE, { tool: "album", params: { amount: 0.5, delivery: "social", format: "mp3", durations: [100, 100] }, inputBytes: [1, 1] });
  if (!c.ok) throw new Error("criar");
  const row = h.rows.get(c.jobId)!;
  assert.ok((await toolStatus(h.d, ALICE, c.jobId)).ok);
  Object.assign(row, { status: "done", outputs: [{ key: `out/${c.jobId}/0.mp3`, name: "faixa-01.mp3", bytes: 10 }, { key: `out/${c.jobId}/2.zip`, name: "album-masterizado.zip", bytes: 20 }] });
  const s = await toolStatus(h.d, ALICE, c.jobId);
  assert.ok(s.ok);
  if (!s.ok) return;
  assert.equal(s.outputs.length, 2);
  assert.match(s.outputs[1].url, /name=album-masterizado\.zip/);
  row.expires_at = new Date(Date.now() - 1000).toISOString();
  const late = await toolStatus(h.d, ALICE, c.jobId);
  assert.ok(late.ok && late.outputs.length === 0);
});

test("cancelar: libera e apaga os arquivos enviados", async () => {
  const h = harness();
  const c = await createTool(h.d, ALICE, { tool: "voice_playback", params: vp, inputBytes: [1, 1] });
  if (!c.ok) throw new Error("criar");
  assert.ok((await cancelTool(h.d, ALICE, c.jobId)).ok);
  assert.equal(h.deleted.length, 2);
});

test("criar: sem o serviço pesado implantado, a separação é recusada sem reservar crédito", async () => {
  const h = harness();
  h.d.stemsAvailable = () => false;
  const s = await createTool(h.d, ALICE, { tool: "stems", params: { format: "wav", durations: [100] }, inputBytes: [10] });
  assert.ok(!s.ok && s.code === "TOOL_UNAVAILABLE");
  assert.equal(h.calls.length, 0);
  const p = await createTool(h.d, ALICE, { tool: "pitch_tempo", params: { semitones: 2, tempo: 1, format: "mp3", durations: [100] }, inputBytes: [10] });
  assert.ok(p.ok);
});

test("criar: conversão para FLAC é grátis e liberada sem o Plano Pro (WMA/AIFF no Studio)", async () => {
  const h = harness();
  const r = await createTool(h.d, ALICE, { tool: "convert", params: { format: "flac", durations: [600] }, inputBytes: [10] });
  assert.ok(r.ok && r.credits === 0, JSON.stringify(r));
  const p = await createTool(h.d, ALICE, { tool: "pitch_tempo", params: { semitones: 2, tempo: 1, format: "flac", durations: [100] }, inputBytes: [10] });
  assert.ok(!p.ok && p.code === "PRO_ONLY");
});
