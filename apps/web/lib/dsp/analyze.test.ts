import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeAudio, guessInstrument } from "./analyze";
import { applySections, butterworth } from "./filters";

const SR = 16000;
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** "Fala": voz com tom (harmônicos de ~140 Hz, como as cordas vocais), sílabas ~4,5/s e pausas entre frases. */
function speechLike(seconds: number, noise = 0) {
  const n = SR * seconds;
  const src = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (2 * Math.PI * (140 + 20 * Math.sin((2 * Math.PI * 0.7 * i) / SR))) / SR; // entonação
    for (let h = 1; h <= 12; h++) src[i] += (0.25 * Math.sin(h * ph)) / h;
  }
  applySections(src, [...butterworth("hp", 2, 250, SR), ...butterworth("lp", 2, 3000, SR)]);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const phrase = t % 3 < 2.2 ? 1 : 0; // 2,2 s falando, 0,8 s de pausa
    const syl = Math.max(0, Math.sin(2 * Math.PI * 4.5 * t)) ** 2;
    x[i] = src[i] * 0.6 * phrase * syl + rnd() * noise;
  }
  return x;
}

/** "Música pronta" (mix densa e masterizada): banda larga contínua + baixo, volume quase constante. */
function musicLike(seconds: number) {
  const n = SR * seconds;
  const mix = Float32Array.from({ length: n }, rnd);
  applySections(mix, butterworth("lp", 1, 2000, SR)); // espectro caindo para os agudos, como uma mix
  return Float32Array.from(mix, (v, i) => 0.5 * v + 0.2 * Math.sin((2 * Math.PI * 55 * i) / SR));
}

/** "Bateria": bumbo grave e caixa a 100 bpm. */
function drumsLike(seconds: number) {
  const x = new Float32Array(SR * seconds);
  const beat = 0.6;
  for (let t = 0; t < seconds - 0.5; t += beat) {
    const s0 = Math.round(t * SR);
    const snare = Math.round(t / beat) % 2 === 1;
    for (let i = 0; i < SR * 0.4 && s0 + i < x.length; i++) {
      const s = i / SR;
      x[s0 + i] += snare ? 0.4 * rnd() * Math.exp(-s / 0.08) : 0.8 * Math.sin(2 * Math.PI * (50 + 60 * Math.exp(-s / 0.03)) * s) * Math.exp(-s / 0.2);
    }
  }
  return x;
}

/** "Instrumento": notas de guitarra com ataque e decaimento, uma por segundo. */
function instrumentLike(seconds: number) {
  const notes = [196, 247, 294, 330, 262, 220];
  return Float32Array.from({ length: SR * seconds }, (_, i) => {
    const t = i / SR;
    const f = notes[Math.floor(t) % notes.length];
    const tt = t % 1;
    return 0.3 * Math.exp(-tt / 0.5) * (Math.sin(2 * Math.PI * f * tt) + 0.4 * Math.sin(4 * Math.PI * f * tt));
  });
}

test("Análise automática reconhece fala, música, bateria e instrumento", () => {
  assert.equal(analyzeAudio([speechLike(20)], SR).kind, "speech");
  assert.equal(analyzeAudio([musicLike(20)], SR).kind, "music");
  assert.equal(analyzeAudio([drumsLike(20)], SR).kind, "drums");
  assert.equal(analyzeAudio([instrumentLike(20)], SR).kind, "instrument");
});

/** "Canto": a mesma voz com tom, mas em notas longas (~1 por segundo) e quase sem pausas. */
function singingLike(seconds: number, noise = 0) {
  const n = SR * seconds;
  const notes = [196, 220, 247, 262, 294, 262, 247, 220];
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f0 = notes[Math.floor(t / 1.2) % notes.length] * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * t)); // vibrato
    ph += (2 * Math.PI * f0) / SR;
    let v = 0;
    for (let h = 1; h <= 10; h++) v += (0.25 * Math.sin(h * ph)) / h;
    const env = 0.6 + 0.4 * Math.min(1, (t % 1.2) / 0.08); // ataque curto e nota sustentada
    x[i] = v * env + rnd() * noise;
  }
  applySections(x, [...butterworth("hp", 2, 250, SR), ...butterworth("lp", 2, 3000, SR)]);
  return x;
}

test("Voz cantada é reconhecida como canto (não como fala) e mantém o som original", () => {
  const a = analyzeAudio([singingLike(20, 0.01)], SR);
  assert.equal(a.kind, "singing", JSON.stringify(a.features));
  assert.equal(a.noise, "clean");
});

test("Ruído de fundo: medido na fala, nunca ligado em música ou bateria", () => {
  assert.equal(analyzeAudio([speechLike(20)], SR).noise, "clean");
  assert.notEqual(analyzeAudio([speechLike(20, 0.02)], SR).noise, "clean");
  assert.equal(analyzeAudio([musicLike(20)], SR).noise, "clean");
  assert.equal(analyzeAudio([drumsLike(20)], SR).noise, "clean");
});

test("Bateria real gravada no celular não é confundida com fala", () => {
  // 4 s do vídeo de exemplo da página inicial (som direto do celular, antes do tratamento)
  const b = readFileSync(fileURLToPath(new URL("./fixtures/bateria-celular-real.wav", import.meta.url)));
  const sr = b.readUInt32LE(24);
  const x = new Float32Array((b.length - 44) / 2);
  for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768;
  const a = analyzeAudio([x], sr);
  assert.equal(a.kind, "drums", JSON.stringify(a.features));
  assert.equal(a.noise, "clean"); // remoção de ruído (feita para voz) fica desligada
});

test("Gravação estourada é detectada", () => {
  const x = speechLike(10).map((v) => Math.max(-1, Math.min(1, v * 8)));
  assert.ok(analyzeAudio([x], SR).clipping > 0.001);
  assert.equal(analyzeAudio([speechLike(10)], SR).clipping, 0);
});

test("palpite de instrumento: baixo pelo grave, violão pelo brilho, plugado pelo fundo silencioso", () => {
  assert.equal(guessInstrument({ bassShare: 0.7, air: 0.001, snrDb: 30 }).type, "baixo");
  assert.equal(guessInstrument({ bassShare: 0.2, air: 0.03, snrDb: 30 }).type, "violao");
  assert.equal(guessInstrument({ bassShare: 0.2, air: 0.001, snrDb: 30 }).type, "guitarra");
  assert.equal(guessInstrument({ bassShare: 0.2, air: 0.001, snrDb: 60 }).source, "plugado");
  assert.equal(guessInstrument({ bassShare: 0.2, air: 0.001, snrDb: 20 }).source, "mic");
});
