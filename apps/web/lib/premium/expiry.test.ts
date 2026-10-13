import { test } from "node:test";
import assert from "node:assert/strict";
import { daysLeft, expiringSoon } from "./expiry";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

test("avisa só projeto entregue que expira em menos de 3 dias e ainda não expirou", () => {
  assert.equal(expiringSoon("delivered", inDays(2.5), NOW), true);
  assert.equal(expiringSoon("delivered", inDays(0.2), NOW), true);
  assert.equal(expiringSoon("delivered", inDays(3.5), NOW), false);
  assert.equal(expiringSoon("delivered", inDays(-1), NOW), false, "já expirou");
  assert.equal(expiringSoon("processing", inDays(1), NOW), false, "ainda não entregue");
  assert.equal(daysLeft(inDays(2.5), NOW), 2);
  assert.equal(daysLeft(inDays(0.2), NOW), 0);
});
