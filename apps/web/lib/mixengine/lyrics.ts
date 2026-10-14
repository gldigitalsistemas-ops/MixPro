/**
 * Letra da Produção: limpeza da transcrição (Whisper), partes da música e o mapa com o tempo de cada linha.
 *
 * O mapa é o que guia o cantor: a voz da IA canta a melodia no lugar certo, mas pronuncia mal; a letra certa
 * (a da pessoa) é alinhada às palavras que o Whisper ouviu nessa voz, palavra por palavra (programação dinâmica),
 * e cada linha ganha o instante em que entra.
 */

export type HeardWord = { w: string; start: number; end: number };
export type HeardSegment = { start: number; end: number; text: string; words?: HeardWord[] };
export type MapLine = { line: string; part: string; start: number | null; end: number | null };

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Frases que o Whisper inventa em trechos sem voz (créditos de legenda, pedidos de inscrição…). */
const HALLUCINATION = /legenda|legendas|inscreva|obrigad[oa] por assistir|amara\.org|subtitles|thanks for watching|transcri/i;

/** Tira alucinações: créditos, "parapara…", linhas em caixa alta e trechos longos com quase nenhuma palavra. */
export function cleanTranscript(segments: HeardSegment[]): HeardSegment[] {
  return segments.filter((s) => {
    const t = s.text.trim();
    if (!t || HALLUCINATION.test(t)) return false;
    const words = norm(t);
    if (!words.length) return false;
    if (/(\w{2,4})\1{3,}/i.test(t.replace(/[\s,.-]/g, ""))) return false;
    if (t.length > 6 && t === t.toUpperCase() && /[A-Z]/.test(t)) return false;
    if ((s.end - s.start) / words.length > 4) return false;
    return true;
  });
}

/** Linhas da letra (sem marcas [Verse]/[Refrão] e sem linhas vazias). */
export function lyricLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[.*\]$/.test(l))
    .slice(0, 200);
}

/** Letra a partir da transcrição limpa: uma linha por trecho cantado. */
export function linesFromTranscript(segments: HeardSegment[]): string[] {
  return cleanTranscript(segments)
    .map((s) => s.text.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

/**
 * Partes da música: o refrão é o que se repete MAIS que o resto (a estrofe também pode voltar com a mesma letra);
 * as outras linhas são estrofes; depois do último refrão, o final (ponte/encerramento).
 */
export function partsOf(lines: string[]): string[] {
  const key = (l: string) => norm(l).join(" ");
  const count = new Map<string, number>();
  for (const l of lines) count.set(key(l), (count.get(key(l)) ?? 0) + 1);
  // mediana (inferior) das repetições por linha DISTINTA: o refrão fica acima dela
  const counts = [...count.values()].sort((a, b) => a - b);
  const median = counts[Math.floor((counts.length - 1) / 2)] ?? 0;
  const chorus = (l: string) => {
    const c = count.get(key(l)) ?? 0;
    return c >= 2 && c > median;
  };
  const lastChorus = lines.map(chorus).lastIndexOf(true);
  return lines.map((l, i) => (chorus(l) ? "Refrão" : lastChorus >= 0 && i > lastChorus ? "Final" : "Estrofe"));
}

function similar(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  // bigramas: tolera a pronúncia ruim da voz da IA ("ceno" × "senhor", "rinto" × "senhor"…)
  const bg = (s: string) => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
  const x = bg(a);
  const y = bg(b);
  let inter = 0;
  for (const g of x) if (y.has(g)) inter++;
  return (2 * inter) / (x.size + y.size);
}

/**
 * Alinha as linhas da letra às palavras ouvidas (com tempo). Alinhamento global (Needleman–Wunsch) das palavras
 * da letra com as ouvidas; cada linha começa no tempo da primeira palavra casada. Linhas sem nenhuma palavra casada
 * ficam entre as vizinhas (interpoladas) ou sem tempo.
 */
export function alignLyrics(lines: string[], heard: HeardWord[]): MapLine[] {
  const parts = partsOf(lines);
  const lw: { w: string; line: number }[] = [];
  lines.forEach((l, i) => norm(l).forEach((w) => lw.push({ w, line: i })));
  const hw = heard.map((h) => ({ ...h, n: norm(h.w)[0] ?? "" })).filter((h) => h.n);
  const n = lw.length;
  const m = hw.length;
  const out: MapLine[] = lines.map((line, i) => ({ line, part: parts[i], start: null, end: null }));
  if (!n || !m) return out;
  // pontuação: casar palavras parecidas vale até +2; pular uma palavra (de qualquer lado) custa −0,6
  const GAP = -0.6;
  const W = m + 1;
  const score = new Float32Array((n + 1) * W);
  const from = new Uint8Array((n + 1) * W); // 0 diagonal, 1 pula letra, 2 pula ouvida
  for (let i = 1; i <= n; i++) {
    score[i * W] = i * GAP;
    from[i * W] = 1;
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * GAP * 0.5; // a voz pode ter introdução/ad-libs antes da letra: pular ouvidas custa menos
    from[j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = similar(lw[i - 1].w, hw[j - 1].n);
      const d = score[(i - 1) * W + j - 1] + (s >= 0.5 ? 2 * s : -0.4);
      const up = score[(i - 1) * W + j] + GAP;
      const left = score[i * W + j - 1] + GAP * 0.5;
      let best = d;
      let f = 0;
      if (up > best) {
        best = up;
        f = 1;
      }
      if (left > best) {
        best = left;
        f = 2;
      }
      score[i * W + j] = best;
      from[i * W + j] = f;
    }
  }
  const startOf = new Array<number | null>(lines.length).fill(null);
  const endOf = new Array<number | null>(lines.length).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const f = from[i * W + j];
    if (f === 0) {
      if (similar(lw[i - 1].w, hw[j - 1].n) >= 0.5) {
        const li = lw[i - 1].line;
        startOf[li] = hw[j - 1].start; // percorre de trás para frente: a última atribuição é a primeira palavra
        endOf[li] ??= hw[j - 1].end;
      }
      i--;
      j--;
    } else if (f === 1) i--;
    else j--;
  }
  // linhas sem tempo: entre a anterior e a próxima conhecidas
  for (let k = 0; k < lines.length; k++) {
    if (startOf[k] !== null) continue;
    let a = k - 1;
    while (a >= 0 && startOf[a] === null) a--;
    let b = k + 1;
    while (b < lines.length && startOf[b] === null) b++;
    if (a >= 0 && b < lines.length) {
      const t0 = endOf[a] ?? startOf[a]!;
      const t1 = startOf[b]!;
      startOf[k] = t0 + ((t1 - t0) * (k - a)) / (b - a);
    }
  }
  // tempos sempre crescentes (o refrão repetido não pode "voltar")
  let last = -1;
  for (let k = 0; k < lines.length; k++) {
    if (startOf[k] === null) continue;
    if (startOf[k]! < last) startOf[k] = null;
    else last = startOf[k]!;
  }
  return out.map((o, k) => ({ ...o, start: startOf[k] === null ? null : Math.round(startOf[k]! * 100) / 100, end: endOf[k] === null ? null : Math.round(endOf[k]! * 100) / 100 }));
}

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;

/** Letra com tempo (.lrc): abre em players e em vários programas de gravação. */
export function toLrc(map: MapLine[], meta: { title?: string; bpm?: number; key?: string | null } = {}): string {
  const head = [meta.title ? `[ti:${meta.title}]` : null, `[by:Mix Pro]`, meta.bpm ? `[re:${Math.round(meta.bpm)} BPM${meta.key ? ` · ${meta.key}` : ""}]` : null].filter(Boolean);
  return [...head, ...map.filter((l) => l.start !== null).map((l) => `[${mmss(l.start!)}]${l.line}`)].join("\n") + "\n";
}
