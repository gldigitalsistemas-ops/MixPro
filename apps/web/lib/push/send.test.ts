import { test } from "node:test";
import assert from "node:assert/strict";
import { sendDaily, type Store, type Sub } from "./send";

const sub = (id: string, user: string | null, failures = 0): Sub => ({ id, endpoint: `https://fcm.googleapis.com/${id}`, p256dh: "p", auth: "a", user_id: user, failures });
const msg = { title: "t", body: "b", url: "/estudio" };

function fakeStore(subs: Sub[], active: string[] = []) {
  const log = { sent: [] as string[], removed: [] as string[], bumped: [] as string[] };
  const store: Store = {
    due: async () => subs,
    activeToday: async () => new Set(active),
    markSent: async (ids) => void log.sent.push(...ids),
    remove: async (ids) => void log.removed.push(...ids),
    bumpFailures: async (s) => void log.bumped.push(...s.map((x) => x.id)),
  };
  return { store, log };
}

test("envia a quem não usou hoje, apaga inscrições mortas e conta falhas", async () => {
  const { store, log } = fakeStore([sub("a", "u1"), sub("b", "u2"), sub("c", null), sub("d", null), sub("e", null, 4), sub("f", null)], ["u2"]);
  const status: Record<string, number> = { a: 201, c: 201, d: 410, e: 500, f: 500 };
  const r = await sendDaily(store, async (s, payload) => {
    assert.deepEqual(JSON.parse(payload), msg);
    return { status: status[s.id] };
  }, msg);
  assert.deepEqual(r, { candidatos: 6, pulados_ativos: 1, enviados: 2, removidos: 2, falhas: 1 });
  assert.deepEqual(log.sent.sort(), ["a", "c"]);
  assert.deepEqual(log.removed.sort(), ["d", "e"], "410 e a 5ª falha seguida saem");
  assert.deepEqual(log.bumped, ["f"]);
});

test("erro lançado pela biblioteca com statusCode 404 também apaga", async () => {
  const { store, log } = fakeStore([sub("x", null)]);
  await sendDaily(store, async () => {
    throw Object.assign(new Error("gone"), { statusCode: 404 });
  }, msg);
  assert.deepEqual(log.removed, ["x"]);
});

test("sem inscrições: não chama nada", async () => {
  const { store } = fakeStore([]);
  const r = await sendDaily(store, async () => {
    throw new Error("não deveria enviar");
  }, msg);
  assert.equal(r.enviados, 0);
});
