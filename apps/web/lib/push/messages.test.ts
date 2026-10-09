import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY_MESSAGES, messageForDay, validSubscription } from "./messages";

test("uma mensagem por dia, sem repetir em dias seguidos, e virando à meia-noite de Brasília", () => {
  const d1 = messageForDay(new Date("2026-10-09T22:00:00Z"));
  const d2 = messageForDay(new Date("2026-10-10T22:00:00Z"));
  assert.notDeepEqual(d1, d2);
  // 01:00 UTC ainda é o dia anterior em Brasília
  assert.deepEqual(messageForDay(new Date("2026-10-10T01:00:00Z")), d1);
  for (const m of DAILY_MESSAGES) {
    assert.ok(m.title.length <= 60 && m.body.length <= 120, m.title);
    assert.ok(m.url.startsWith("/"));
  }
});

const keys = { p256dh: "B" + "a".repeat(86), auth: "b".repeat(22) };
test("inscrição: só serviços de push conhecidos e chaves no formato certo", () => {
  for (const ep of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QAbc",
    "https://wns2-bl2p.notify.windows.com/w/?token=x",
  ])
    assert.ok(validSubscription({ endpoint: ep, keys }), ep);
  for (const ep of ["http://fcm.googleapis.com/x", "https://evil.example/fcm.googleapis.com/", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.com/x"])
    assert.equal(validSubscription({ endpoint: ep, keys }), null, ep);
  assert.equal(validSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "x", auth: "y" } }), null);
  assert.equal(validSubscription(null), null);
});
