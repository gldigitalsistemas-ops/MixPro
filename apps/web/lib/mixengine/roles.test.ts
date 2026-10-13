import { test } from "node:test";
import assert from "node:assert/strict";
import { guessRole, targetLevel } from "./roles";

test("reconhece o papel pelo nome do arquivo (português e inglês)", () => {
  const cases: [string, string][] = [
    ["01 Kick In.wav", "kick"],
    ["Bumbo.wav", "kick"],
    ["Caixa Cima.wav", "snare"],
    ["SNARE_BOTTOM.wav", "snare"],
    ["Chimbal.wav", "hihat"],
    ["Tom 1.wav", "toms"],
    ["Surdo.wav", "toms"],
    ["OH L.wav", "overheads"],
    ["Room.wav", "room"],
    ["Baixo DI.wav", "bass"],
    ["Bass Amp.wav", "bass"],
    ["Violão Aço.wav", "acoustic_guitar"],
    ["Guitarra Base L.wav", "electric_guitar"],
    ["GTR Solo.wav", "electric_guitar"],
    ["Teclado.wav", "keys"],
    ["Sanfona.wav", "keys"],
    ["Piano.wav", "piano"],
    ["Pad Atmos.wav", "pad"],
    ["Synth Lead.wav", "synth"],
    ["Voz Principal.wav", "lead_vocal"],
    ["Lead Vox.wav", "lead_vocal"],
    ["Backing Vocals.wav", "backing_vocal"],
    ["Voz 2.wav", "backing_vocal"],
    ["Pandeiro.wav", "percussion"],
    ["Drum Loop 90bpm.wav", "loop"],
    ["Riser FX.wav", "fx"],
    ["Cordas.wav", "strings"],
    ["Sax.wav", "brass"],
    ["Bateria Stereo.wav", "drums"],
    ["Audio 12.wav", "other"],
  ];
  for (const [name, role] of cases) assert.equal(guessRole(name), role, name);
});

test("volume por estilo: worship sobe os pads; funk sobe o grave", () => {
  assert.equal(targetLevel("pad", "worship"), -9);
  assert.equal(targetLevel("bass", "funk"), -1);
  assert.equal(targetLevel("lead_vocal", "pop"), 0);
});
