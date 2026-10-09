import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildReport } from "./build";
import { winAnsi } from "./pdf";
import { measureAudio, diagnose } from "@/lib/dsp/diagnose";

const tone = (sr: number, s: number, amp: number) => {
  const a = new Float32Array(sr * s);
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * 220 * i) / sr) + (Math.random() - 0.5) * 0.002;
  return [a, a.slice()];
};

test("acentos viram WinAnsi; o que não existe vira ?", () => {
  assert.deepEqual(winAnsi("ãç—😀"), [0xe3, 0xe7, 0x97, 0x3f]);
});

test("relatório: PDF válido (tabela xref aponta para cada objeto) e com as medidas", () => {
  const before = measureAudio(tone(48000, 12, 0.05), 48000);
  const after = measureAudio(tone(48000, 12, 0.5), 48000);
  const findings = diagnose(before, { kind: "music" });
  // muitos achados longos forçam a segunda página
  const many = Array.from({ length: 30 }, (_, i) => ({ ...findings[0], id: `x${i}`, detail: "Texto longo (com parênteses) e acentuação: ação, véu, pão. ".repeat(4) }));
  const bytes = buildReport({
    fileName: "Minha música (final).wav",
    kind: "audio",
    createdAt: new Date(2026, 9, 9, 14, 5),
    preset: "Voz brilhante",
    delivery: { label: "Redes sociais", targetLufs: -14, ceilingDb: -1 },
    before,
    after,
    findings: [...findings, ...many],
    musical: { key: "Lá menor", bpm: 120.4 },
    excerptS: null,
  });
  const s = Buffer.from(bytes).toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  const startxref = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.ok(s.slice(startxref).startsWith("xref"));
  const entries = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  entries.forEach((off, i) => assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `objeto ${i + 1}`));
  assert.match(s, /\/Type \/Pages \/Kids \[[^\]]+\] \/Count [2-9] >>/);
  assert.ok(s.includes(String.raw`Minha m\372sica \(final\).wav`));
  assert.match(s, /120 BPM/);
  if (process.env.REPORT_OUT) writeFileSync(process.env.REPORT_OUT, bytes);
});
