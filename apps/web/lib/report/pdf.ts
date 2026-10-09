/**
 * Gerador de PDF mínimo (texto, retângulos e linhas; fontes padrão Helvetica, sem embutir nada).
 * Suficiente para o relatório técnico e leve o bastante para rodar no celular, sem dependências.
 * Texto em WinAnsi: acentos do português funcionam; o que não existe vira "?".
 */

export type RGB = [number, number, number];

const W = 595.28; // A4 em pontos
const H = 841.89;

/** Unicode → byte WinAnsi (Latin-1 + os extras da faixa 0x80–0x9F que usamos). */
const EXTRA: Record<string, number> = { "—": 0x97, "–": 0x96, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "…": 0x85, "•": 0x95, "€": 0x80 };

export function winAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (EXTRA[ch] !== undefined) out.push(EXTRA[ch]);
    else if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else out.push(0x3f);
  }
  return out;
}

function pdfString(s: string): string {
  return winAnsi(s)
    .map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? "\\" + String.fromCharCode(b) : b < 0x20 || b > 0x7e ? "\\" + b.toString(8).padStart(3, "0") : String.fromCharCode(b)))
    .join("");
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const col = (c: RGB) => c.map((v) => n(v / 255)).join(" ");

/** Largura aproximada do texto (Helvetica ~0,52 em média; negrito um pouco mais). */
export const textWidth = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.56 : 0.52);

export class PdfDoc {
  private pages: string[][] = [[]];
  readonly width = W;
  readonly height = H;

  private get ops() {
    return this.pages[this.pages.length - 1];
  }

  addPage() {
    this.pages.push([]);
  }

  /** `y` medido do topo da página (mais natural para montar de cima para baixo). */
  text(x: number, y: number, s: string, opts: { size?: number; bold?: boolean; color?: RGB } = {}) {
    const size = opts.size ?? 10;
    this.ops.push(`BT /${opts.bold ? "F2" : "F1"} ${n(size)} Tf ${col(opts.color ?? [20, 20, 30])} rg ${n(x)} ${n(H - y)} Td (${pdfString(s)}) Tj ET`);
  }

  rect(x: number, y: number, w: number, h: number, color: RGB) {
    this.ops.push(`${col(color)} rg ${n(x)} ${n(H - y - h)} ${n(w)} ${n(h)} re f`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB = [210, 210, 220], width = 0.6) {
    this.ops.push(`${col(color)} RG ${n(width)} w ${n(x1)} ${n(H - y1)} m ${n(x2)} ${n(H - y2)} l S`);
  }

  /** Quebra o texto em linhas que cabem em `maxW`. */
  wrap(s: string, size: number, maxW: number, bold = false): string[] {
    const lines: string[] = [];
    let cur = "";
    for (const word of s.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (textWidth(next, size, bold) > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** Bytes do arquivo PDF. */
  bytes(): Uint8Array {
    const objs: string[] = [];
    const pageCount = this.pages.length;
    // 1 catálogo, 2 páginas, 3 F1, 4 F2, depois (página, conteúdo) por página
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    const kids = this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
    objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    this.pages.forEach((ops, i) => {
      const content = ops.join("\n");
      objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
      objs[6 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });
    // tudo é ASCII aqui (os acentos já viraram \ooo): 1 caractere = 1 byte
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
    return bytes;
  }
}
