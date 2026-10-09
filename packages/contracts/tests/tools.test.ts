import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TOOL_COSTS, parseToolCosts, parseToolParams, toolCredits } from "../src/index";

test("parâmetros válidos passam; extras, faixas e ferramentas desconhecidas não", () => {
  assert.ok(parseToolParams("pitch_tempo", { semitones: 2, tempo: 1, format: "mp3", durations: [180] }));
  assert.equal(parseToolParams("pitch_tempo", { semitones: 0, tempo: 1, format: "mp3", durations: [180] }), null, "nada a mudar");
  assert.equal(parseToolParams("pitch_tempo", { semitones: 13, tempo: 1, format: "mp3", durations: [180] }), null);
  assert.equal(parseToolParams("pitch_tempo", { semitones: 2, tempo: 1, format: "mp3", durations: [180], extra: 1 }), null);
  assert.equal(parseToolParams("hack", {}), null);
  assert.ok(parseToolParams("voice_playback", { offset_s: null, voice_level_db: 0, reverb: 25, delivery: "social", format: "wav", durations: [120, 125] }));
  assert.equal(parseToolParams("voice_playback", { offset_s: null, voice_level_db: 0, reverb: 25, delivery: "social", format: "wav", durations: [120] }), null);
  assert.equal(parseToolParams("album", { amount: 0.5, delivery: "social", format: "mp3", durations: [100] }), null, "álbum precisa de 2+");
  assert.equal(parseToolParams("stems", { format: "mp3", durations: [700] }), null, "acima de 10 min");
});

test("créditos por recurso e por duração", () => {
  assert.equal(toolCredits("pitch_tempo", { durations: [200] }), 2);
  assert.equal(toolCredits("voice_playback", { durations: [200, 200] }), 3);
  assert.equal(toolCredits("reference_master", { durations: [200, 200] }), 3);
  assert.equal(toolCredits("album", { durations: [100, 100, 100, 100, 100] }), 10);
  assert.equal(toolCredits("stems", { durations: [300] }), 4);
  assert.equal(toolCredits("stems", { durations: [360] }), 4);
  assert.equal(toolCredits("stems", { durations: [361] }), 5);
  assert.equal(toolCredits("stems", { durations: [600] }), 5);
  assert.equal(toolCredits("convert", { durations: [600] }), 0);
});

test("ajuste do admin: valores inválidos voltam ao padrão", () => {
  assert.deepEqual(parseToolCosts(null), DEFAULT_TOOL_COSTS);
  const c = parseToolCosts({ stems: 6, voice_playback: -1, album_track: "x", pitch_tempo: 99 });
  assert.equal(c.stems, 6);
  assert.equal(c.voice_playback, DEFAULT_TOOL_COSTS.voice_playback);
  assert.equal(c.album_track, DEFAULT_TOOL_COSTS.album_track);
  assert.equal(c.pitch_tempo, DEFAULT_TOOL_COSTS.pitch_tempo);
});
