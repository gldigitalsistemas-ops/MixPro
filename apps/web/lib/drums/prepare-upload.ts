"use client";

/**
 * Prepara um sample para a biblioteca, no navegador do admin: decodifica (WAV, MP3, FLAC…),
 * junta em mono, corta o silêncio antes do ataque e a cauda abaixo de -60 dB (máx. 3 s) e
 * grava WAV 16 bits / 48 kHz. Arquivo pequeno = menos armazenamento e carregamento rápido.
 */
const SR = 48000;
const MAX_SECONDS = 3;

export function encodeWav(x: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + x.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), true);
  return new Blob([buf], { type: "audio/wav" });
}

export async function prepareForUpload(file: File): Promise<{ blob: Blob; seconds: number; peakDb: number }> {
  const ctx = new OfflineAudioContext(1, 1, SR);
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`“${file.name}”: formato não suportado neste navegador. Use WAV, MP3 ou FLAC.`);
  }
  const n = decoded.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const d = decoded.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / decoded.numberOfChannels;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak < 1e-4) throw new Error(`“${file.name}” está em silêncio.`);
  let start = 0;
  while (start < n && Math.abs(mono[start]) < peak * 0.02) start++;
  start = Math.max(0, start - Math.round(SR * 0.001));
  let end = n - 1;
  while (end > start && Math.abs(mono[end]) < peak * 0.001) end--;
  end = Math.min(end + 1, start + SR * MAX_SECONDS);
  const out = mono.slice(start, end);
  const fade = Math.min(out.length, Math.round(SR * 0.02));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  // mantém a força original (as camadas leves continuam leves); só evita clipar
  if (peak > 0.999) for (let i = 0; i < out.length; i++) out[i] *= 0.999 / peak;
  return { blob: encodeWav(out, SR), seconds: out.length / SR, peakDb: 20 * Math.log10(Math.min(peak, 1)) };
}
