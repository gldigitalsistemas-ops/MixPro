/**
 * Edit lists de um MP4/MOV, lidas direto do arquivo (só os cabeçalhos; nada do áudio).
 * Serve para o servidor aplicar a MESMA regra do mediabunny, que é o que o app usa
 * (mediabunny/src/isobmff/isobmff-demuxer.js, caso 'elst' e ajuste depois do moov):
 *  - vale só a primeira edição NÃO vazia (media_time ≠ -1); as vazias antes dela somam um atraso;
 *  - deslocamento = media_time − round(atraso_em_segundos × escala da trilha);
 *  - timestamp de cada pacote = (pts − deslocamento) / escala da trilha;
 *  - a duração da edição é ignorada (o fim NÃO é cortado).
 * Só em Node.
 */
import { open } from "node:fs/promises";

export type EditEntry = { segmentDuration: number; mediaTime: number; rate: number };
export type TrackEdits = { handler: string; timescale: number; edits: EditEntry[] };
export type Mp4Edits = { movieTimescale: number; tracks: TrackEdits[] };

type Box = { type: string; start: number; size: number; header: number };

/** Lê as caixas filhas de [start, end). Caixas com tamanho 64 bits e "até o fim do arquivo" incluídas. */
async function boxes(read: (pos: number, len: number) => Promise<Buffer>, start: number, end: number): Promise<Box[]> {
  const out: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    const h = await read(pos, 16);
    let size = h.readUInt32BE(0);
    const type = h.toString("latin1", 4, 8);
    let header = 8;
    if (size === 1) {
      size = Number(h.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) size = end - pos;
    if (size < header || pos + size > end) break;
    out.push({ type, start: pos, size, header });
    pos += size;
  }
  return out;
}

export async function readMp4Edits(path: string): Promise<Mp4Edits | null> {
  const f = await open(path, "r");
  try {
    const { size: fileSize } = await f.stat();
    const read = async (pos: number, len: number) => {
      const b = Buffer.alloc(Math.max(0, Math.min(len, fileSize - pos)));
      await f.read(b, 0, b.length, pos);
      return b;
    };
    const moov = (await boxes(read, 0, fileSize)).find((b) => b.type === "moov");
    if (!moov) return null;
    // moov tem só cabeçalhos (poucos KB a alguns MB): lê inteiro
    const m = await read(moov.start, moov.size);
    const sub = (s: number, e: number) => boxes(async (p, l) => m.subarray(p, p + l), s, e);
    const child = async (b: Box, type: string) => (await sub(b.start - moov.start + b.header, b.start - moov.start + b.size)).map((x) => ({ ...x, start: x.start + moov.start })).find((x) => x.type === type);
    const at = (b: Box) => b.start - moov.start + b.header;

    const top = (await sub(moov.header, moov.size)).map((x) => ({ ...x, start: x.start + moov.start }));
    const mvhd = top.find((b) => b.type === "mvhd");
    if (!mvhd) return null;
    const mv = at(mvhd);
    const movieTimescale = m.readUInt32BE(mv + (m[mv] === 1 ? 20 : 12));

    const tracks: TrackEdits[] = [];
    for (const trak of top.filter((b) => b.type === "trak")) {
      const mdia = await child(trak, "mdia");
      const mdhd = mdia && (await child(mdia, "mdhd"));
      const hdlr = mdia && (await child(mdia, "hdlr"));
      if (!mdhd || !hdlr) continue;
      const md = at(mdhd);
      const timescale = m.readUInt32BE(md + (m[md] === 1 ? 20 : 12));
      const handler = m.toString("latin1", at(hdlr) + 8, at(hdlr) + 12);
      const edits: EditEntry[] = [];
      const edts = await child(trak, "edts");
      const elst = edts && (await child(edts, "elst"));
      if (elst) {
        const e = at(elst);
        const v1 = m[e] === 1;
        const count = m.readUInt32BE(e + 4);
        let p = e + 8;
        for (let i = 0; i < count; i++) {
          const segmentDuration = v1 ? Number(m.readBigUInt64BE(p)) : m.readUInt32BE(p);
          p += v1 ? 8 : 4;
          const mediaTime = v1 ? Number(m.readBigInt64BE(p)) : m.readInt32BE(p);
          p += v1 ? 8 : 4;
          const rate = m.readInt32BE(p) / 65536;
          p += 4;
          edits.push({ segmentDuration, mediaTime, rate });
        }
      }
      tracks.push({ handler, timescale, edits });
    }
    return { movieTimescale, tracks };
  } finally {
    await f.close();
  }
}

/**
 * Deslocamento (em unidades da trilha) que o mediabunny subtrai dos timestamps, e o atraso das
 * edições vazias em segundos (áudio que começa depois do vídeo).
 */
export function mediabunnyOffset(track: TrackEdits, movieTimescale: number): { offset: number; emptyDelayS: number } {
  let previous = 0;
  for (const e of track.edits) {
    if (e.mediaTime === -1) {
      previous += e.segmentDuration;
      continue;
    }
    // taxa ≠ 1: o mediabunny avisa e desiste (deslocamento 0, sem descontar as vazias)
    if (e.rate !== 1) break;
    const emptyDelayS = previous / movieTimescale;
    return { offset: e.mediaTime - Math.round(emptyDelayS * track.timescale), emptyDelayS };
  }
  return { offset: 0, emptyDelayS: 0 };
}
