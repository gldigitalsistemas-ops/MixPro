/**
 * Relatório técnico (PDF): medidas reais do antes e do depois, o diagnóstico e o que foi aplicado.
 * Tudo vem do próprio sinal (nenhum número inventado); gerado no aparelho.
 */
import type { Finding, Measurements } from "@/lib/dsp/diagnose";
import { PdfDoc, type RGB } from "./pdf";

export type ReportData = {
  fileName: string;
  kind: "audio" | "video";
  createdAt: Date;
  preset: string | null;
  delivery: { label: string; targetLufs: number; ceilingDb: number } | null;
  before: Measurements;
  after: Measurements | null;
  findings: Finding[];
  musical: { key: string | null; bpm: number | null } | null;
  /** Trecho medido (s) quando não é o arquivo inteiro. */
  excerptS: number | null;
};

const VIOLET: RGB = [109, 40, 217];
const MUTED: RGB = [110, 110, 125];
const STATUS: Record<Finding["status"], { label: string; color: RGB }> = {
  ok: { label: "OK", color: [16, 150, 100] },
  warn: { label: "ATENÇÃO", color: [190, 120, 0] },
  bad: { label: "PROBLEMA", color: [200, 40, 70] },
};

const fmt = (v: number | null | undefined, digits: number, unit: string) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(digits).replace(".", ",")} ${unit}`);
const pad2 = (v: number) => String(v).padStart(2, "0");
const dateBR = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${pad2(Math.round(s % 60))}`;

export function buildReport(r: ReportData): Uint8Array {
  const pdf = new PdfDoc();
  const L = 48;
  const R = pdf.width - 48;
  let y = 0;

  // cabeçalho
  pdf.rect(0, 0, pdf.width, 92, VIOLET);
  pdf.text(L, 44, "Mix Pro", { size: 22, bold: true, color: [255, 255, 255] });
  pdf.text(L, 68, "Relatório técnico do áudio", { size: 12, color: [235, 225, 255] });
  pdf.text(R - 120, 68, dateBR(r.createdAt), { size: 10, color: [235, 225, 255] });
  y = 124;

  const section = (title: string) => {
    if (y > pdf.height - 120) {
      pdf.addPage();
      y = 60;
    }
    pdf.text(L, y, title, { size: 13, bold: true, color: VIOLET });
    y += 8;
    pdf.line(L, y, R, y, VIOLET, 1);
    y += 18;
  };
  const row = (k: string, v: string) => {
    pdf.text(L, y, k, { size: 10, color: MUTED });
    pdf.text(L + 170, y, v, { size: 10 });
    y += 16;
  };

  section("Arquivo");
  row("Nome", r.fileName.length > 60 ? r.fileName.slice(0, 57) + "…" : r.fileName);
  row("Tipo", `${r.kind === "video" ? "Vídeo" : "Áudio"} · ${mmss(r.before.durationS)} · ${r.before.sampleRate} Hz · ${r.before.channels === 1 ? "mono" : "estéreo"}`);
  if (r.musical?.key) row("Tom", r.musical.key);
  if (r.musical?.bpm) row("Andamento", `${Math.round(r.musical.bpm)} BPM`);
  if (r.excerptS) row("Trecho medido", `${Math.round(r.excerptS)} s`);
  y += 6;

  section("Medidas: antes e depois");
  const cols = [L, L + 170, L + 300];
  pdf.text(cols[1], y, "Antes", { size: 10, bold: true });
  if (r.after) pdf.text(cols[2], y, "Depois", { size: 10, bold: true });
  y += 16;
  const m = (k: string, f: (x: Measurements) => string) => {
    pdf.text(cols[0], y, k, { size: 10, color: MUTED });
    pdf.text(cols[1], y, f(r.before), { size: 10 });
    if (r.after) pdf.text(cols[2], y, f(r.after), { size: 10, bold: true });
    y += 16;
  };
  m("Loudness integrada", (x) => fmt(x.lufs, 1, "LUFS"));
  m("Pico real (true peak)", (x) => fmt(x.truePeakDb, 1, "dBTP"));
  m("Pico de amostra", (x) => fmt(x.peakDb, 1, "dBFS"));
  m("RMS", (x) => fmt(x.rmsDb, 1, "dBFS"));
  m("Faixa de loudness (LRA)", (x) => fmt(x.lra, 1, "LU"));
  m("Pico/loudness (PLR)", (x) => fmt(x.plrDb, 1, "dB"));
  m("Ruído de fundo", (x) => fmt(x.noiseFloorDb, 0, "dBFS"));
  y += 6;

  if (r.preset || r.delivery) {
    section("O que foi aplicado");
    if (r.preset) row("Som (preset)", r.preset);
    if (r.delivery) row("Entrega", `${r.delivery.label} · alvo ${r.delivery.targetLufs} LUFS · teto ${r.delivery.ceilingDb} dBTP`);
    y += 6;
  }

  section("Diagnóstico do original");
  for (const f of r.findings) {
    const st = STATUS[f.status];
    const lines = pdf.wrap(f.detail, 9, R - L - 90);
    if (y + 16 + lines.length * 12 > pdf.height - 60) {
      pdf.addPage();
      y = 60;
    }
    pdf.text(L, y, st.label, { size: 8, bold: true, color: st.color });
    pdf.text(L + 80, y, f.label, { size: 10, bold: true });
    y += 13;
    for (const l of lines) {
      pdf.text(L + 80, y, l, { size: 9, color: MUTED });
      y += 12;
    }
    y += 6;
  }

  // rodapé (última página)
  const foot = "Medidas conforme ITU-R BS.1770-4 (loudness e true peak). Gerado pelo Mix Pro no seu aparelho.";
  pdf.text(L, pdf.height - 30, foot, { size: 8, color: MUTED });
  return pdf.bytes();
}
