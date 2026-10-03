/**
 * Leitura de WAV (PCM 16/24/32 bits ou float 32) sem Web Audio, para Node.
 *
 * PCM 16 bits (o formato da biblioteca de samples e IRs): mesma conversão do decodeAudioData do
 * Chrome, que é assimétrica e em float32: positivos × (1/32767), negativos × (1/32768). Conferido
 * amostra a amostra contra o Chrome (idêntico). 24/32 bits: escala simétrica, NÃO conferida.
 */
import type { Signal } from "@/lib/dsp/types";

const POS16 = Math.fround(1 / 32767);
const NEG16 = Math.fround(1 / 32768);

export type DecodedWav = { sampleRate: number; channels: Signal };

export function decodeWav(bytes: Uint8Array): DecodedWav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("não é um arquivo WAV");
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: { offset: number; size: number } | null = null;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      let format = v.getUint16(o + 8, true);
      // WAVE_FORMAT_EXTENSIBLE: o formato real está no subformato
      if (format === 0xfffe) format = v.getUint16(o + 32, true);
      fmt = { format, channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    } else if (id === "data") data = { offset: o + 8, size: Math.min(size, bytes.length - o - 8) };
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("WAV sem 'fmt ' ou 'data'");
  const { format, channels: nch, bits } = fmt;
  const bytesPer = bits / 8;
  const frames = Math.floor(data.size / (bytesPer * nch));
  const channels: Signal = Array.from({ length: nch }, () => new Float32Array(frames));
  const read =
    format === 3 && bits === 32
      ? (o: number) => v.getFloat32(o, true)
      : format === 1 && bits === 16
        ? (o: number) => {
            const x = v.getInt16(o, true);
            return Math.fround(x * (x < 0 ? NEG16 : POS16));
          }
        : format === 1 && bits === 24
          ? (o: number) => ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608)
          : format === 1 && bits === 32
            ? (o: number) => v.getInt32(o, true) / 2147483648
            : null;
  if (!read) throw new Error(`WAV não suportado (formato ${format}, ${bits} bits)`);
  for (let i = 0, o = data.offset; i < frames; i++)
    for (let c = 0; c < nch; c++, o += bytesPer) channels[c][i] = read(o);
  return { sampleRate: fmt.sampleRate, channels };
}

/** WAV float 32 (sem perda): usado para entradas de teste e saídas de comparação. */
export function encodeWavFloat(channels: Signal, sampleRate: number): Uint8Array {
  const n = channels[0].length;
  const nch = channels.length;
  const dataBytes = n * nch * 4;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 4, true);
  v.setUint16(32, nch * 4, true);
  v.setUint16(34, 32, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < nch; c++, o += 4) v.setFloat32(o, channels[c][i], true);
  return out;
}
