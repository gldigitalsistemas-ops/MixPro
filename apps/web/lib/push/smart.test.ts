import { test } from "node:test";
import assert from "node:assert/strict";
import { smartMessage } from "./smart";
import { sendDaily, type Store, type Sub } from "./send";

const daily = { title: "d", body: "d", url: "/estudio" };

test("prioridade: expirando > próxima etapa > saudade > mensagem do dia", () => {
  assert.equal(smartMessage({ expiringTool: "stems", lastTool: "stems", daysSinceActive: 30 }, daily).url, "/projetos");
  assert.equal(smartMessage({ lastTool: "stems", daysSinceActive: 30 }, daily).url, "/vs");
  assert.match(smartMessage({ daysSinceActive: 8 }, daily).title, /Faz tempo/);
  assert.equal(smartMessage({ daysSinceActive: 2 }, daily), daily);
  assert.equal(smartMessage({ lastTool: "desconhecida" }, daily), daily);
  assert.equal(smartMessage(undefined, daily), daily);
});

test("o envio usa o contexto de cada usuário; sem usuário ou com erro no contexto, a mensagem do dia", async () => {
  const sub = (id: string, user: string | null): Sub => ({ id, endpoint: `https://fcm.googleapis.com/${id}`, p256dh: "p", auth: "a", user_id: user, failures: 0 });
  const got: Record<string, string> = {};
  const base: Store = {
    due: async () => [sub("a", "u1"), sub("b", "u2"), sub("c", null)],
    activeToday: async () => new Set(),
    markSent: async () => {},
    remove: async () => {},
    bumpFailures: async () => {},
    context: async () => new Map([["u1", { lastTool: "pitch_tempo" }]]),
  };
  await sendDaily(base, async (s, p) => ((got[s.id] = JSON.parse(p).url), { status: 201 }), daily);
  assert.deepEqual({ ...got }, { a: "/ferramentas?ferramenta=voice_playback", b: "/estudio", c: "/estudio" });
  const broken: Store = { ...base, context: async () => Promise.reject(new Error("banco")) };
  await sendDaily(broken, async (s, p) => ((got[s.id] = JSON.parse(p).url), { status: 201 }), daily);
  assert.equal(got.a, "/estudio");
});
