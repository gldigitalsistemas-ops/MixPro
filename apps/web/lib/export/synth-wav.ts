/**
 * WAVs sintéticos para a paridade de decodificação (Etapa 4, fatia 2). Determinísticos: o mesmo
 * conteúdo em qualquer máquina, então o CI recria os arquivos e compara com a referência do app
 * (lib/export/fixtures/decode-reference.json) sem guardar áudio no repositório.
 */
export type WavSpec = { name: string; sr: number; ch: number; bits: 16 | 24 | 32; float?: boolean; extensible?: boolean; seconds: number; identical?: boolean; /** Ganho antes de gravar (só float passa de 1). */ gain?: number };
export const SYNTH_WAVS: WavSpec[] = [
  { name: "sint-16bit-44k1-estereo.wav", sr: 44100, ch: 2, bits: 16, seconds: 6 },
  { name: "sint-16bit-48k-mono.wav", sr: 48000, ch: 1, bits: 16, seconds: 6 },
  { name: "sint-24bit-48k-estereo.wav", sr: 48000, ch: 2, bits: 24, seconds: 6 },
  { name: "sint-24bit-44k1-mono-extensible.wav", sr: 44100, ch: 1, bits: 24, extensible: true, seconds: 6 },
  { name: "sint-float32-48k-estereo.wav", sr: 48000, ch: 2, bits: 32, float: true, seconds: 6 },
  { name: "sint-16bit-48k-estereo-identico.wav", sr: 48000, ch: 2, bits: 16, seconds: 6, identical: true },
  { name: "sint-16bit-48k-curto-0s3.wav", sr: 48000, ch: 2, bits: 16, seconds: 0.3 },
  // valores acima de 1 (só em float): o app limita ou não?
  { name: "sint-float32-48k-estereo-acima-de-1.wav", sr: 48000, ch: 2, bits: 32, float: true, seconds: 6, gain: 2.2 },
];

/** WAV sintético determinístico (mesmos bytes em qualquer máquina). */
export function synthWav(s: WavSpec): Buffer {
  const n = Math.round(s.sr * s.seconds);
  const bytes = s.bits / 8;
  const fmtSize = s.extensible ? 40 : 16;
  const data = n * s.ch * bytes;
  const buf = Buffer.alloc(12 + 8 + fmtSize + 8 + data);
  let o = 0;
  const str = (t: string) => {
    buf.write(t, o, "latin1");
    o += 4;
  };
  str("RIFF");
  buf.writeUInt32LE(4 + 8 + fmtSize + 8 + data, o);
  o += 4;
  str("WAVE");
  str("fmt ");
  buf.writeUInt32LE(fmtSize, o);
  const format = s.float ? 3 : 1;
  buf.writeUInt16LE(s.extensible ? 0xfffe : format, o + 4);
  buf.writeUInt16LE(s.ch, o + 6);
  buf.writeUInt32LE(s.sr, o + 8);
  buf.writeUInt32LE(s.sr * s.ch * bytes, o + 12);
  buf.writeUInt16LE(s.ch * bytes, o + 16);
  buf.writeUInt16LE(s.bits, o + 18);
  if (s.extensible) {
    buf.writeUInt16LE(22, o + 20);
    buf.writeUInt16LE(s.bits, o + 22);
    buf.writeUInt32LE(s.ch === 1 ? 4 : 3, o + 24);
    // GUID do subformato: os 2 primeiros bytes são o formato (1 = PCM, 3 = float)
    Buffer.from([format, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71]).copy(buf, o + 28);
  }
  o += fmtSize + 4;
  str("data");
  buf.writeUInt32LE(data, o);
  o += 4;
  let seed = 9;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / s.sr;
    // música simples + ruído + um transiente por segundo (dá onde a correlação se apoiar)
    const base = 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.15 * Math.sin(2 * Math.PI * 331 * t) + 0.05 * rnd() + (t % 1 < 0.01 ? 0.4 * rnd() : 0);
    for (let c = 0; c < s.ch; c++) {
      const raw = (s.gain ?? 1) * (s.identical || c === 0 ? base : 0.8 * base + 0.1 * Math.sin(2 * Math.PI * 97 * t));
      const v = s.float ? raw : Math.max(-1, Math.min(1, raw));
      if (s.float) buf.writeFloatLE(v, o);
      else if (s.bits === 16) buf.writeInt16LE(Math.round(v * 32767), o);
      else if (s.bits === 24) buf.writeIntLE(Math.round(v * 8388607), o, 3);
      o += bytes;
    }
  }
  return buf;
}

