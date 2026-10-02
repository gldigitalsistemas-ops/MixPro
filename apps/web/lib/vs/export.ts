/**
 * Arquivos do VS: cada pista em WAV, todas num ZIP, ou a mistura em estéreo (com volume, pan,
 * mudo e solo do mixer). Tudo em 16 bits, 44,1 kHz.
 */
export type TrackData = { id: string; label: string; left: Int16Array; right: Int16Array };
export type TrackMix = { volume: number; pan: number; mute: boolean; solo: boolean };

/** Ganho efetivo de cada pista (solo cala as outras; mudo cala a pista). */
export function effectiveGains(mix: Record<string, TrackMix>): Record<string, number> {
  const anySolo = Object.values(mix).some((m) => m.solo);
  return Object.fromEntries(Object.entries(mix).map(([id, m]) => [id, m.mute || (anySolo && !m.solo) ? 0 : m.volume]));
}

/**
 * Pan de fonte estéreo igual ao StereoPannerNode do navegador (a prévia soa como o arquivo):
 * para a esquerda, o canal direito vai sendo jogado na esquerda; para a direita, o contrário.
 * Devolve [L←L, L←R, R←L, R←R].
 */
export function panMatrix(pan: number): [number, number, number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  if (p <= 0) {
    const x = ((p + 1) * Math.PI) / 2;
    return [1, Math.cos(x), 0, Math.sin(x)];
  }
  const x = (p * Math.PI) / 2;
  return [Math.cos(x), 0, Math.sin(x), 1];
}

/**
 * Mistura em estéreo (16 bits). Se passar do teto, abaixa tudo por igual (sem distorcer): o pico
 * fica em -1 dBFS.
 */
export function mixdown(tracks: TrackData[], mix: Record<string, TrackMix>): { left: Int16Array; right: Int16Array } {
  const n = Math.max(...tracks.map((t) => t.left.length));
  const gains = effectiveGains(mix);
  const parts = tracks
    .filter((t) => gains[t.id] > 0)
    .map((t) => {
      const g = gains[t.id] / 32768;
      const [ll, lr, rl, rr] = panMatrix(mix[t.id].pan);
      return { t, ll: ll * g, lr: lr * g, rl: rl * g, rr: rr * g };
    });
  // 1ª passada: pico
  let peak = 0;
  const STEP = 4096;
  const L = new Float32Array(STEP);
  const R = new Float32Array(STEP);
  const render = (start: number, len: number) => {
    L.fill(0, 0, len);
    R.fill(0, 0, len);
    for (const p of parts) {
      for (let i = 0; i < len; i++) {
        const l = p.t.left[start + i] ?? 0;
        const r = p.t.right[start + i] ?? 0;
        L[i] += l * p.ll + r * p.lr;
        R[i] += l * p.rl + r * p.rr;
      }
    }
  };
  for (let s = 0; s < n; s += STEP) {
    const len = Math.min(STEP, n - s);
    render(s, len);
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const ceiling = 10 ** (-1 / 20);
  const g = peak > ceiling ? ceiling / peak : 1;
  const left = new Int16Array(n);
  const right = new Int16Array(n);
  for (let s = 0; s < n; s += STEP) {
    const len = Math.min(STEP, n - s);
    render(s, len);
    for (let i = 0; i < len; i++) {
      left[s + i] = Math.round(L[i] * g * 32767);
      right[s + i] = Math.round(R[i] * g * 32767);
    }
  }
  return { left, right };
}

/** WAV estéreo 16 bits. */
export function wavBlob(left: Int16Array, right: Int16Array, sr: number): Blob {
  const n = left.length;
  const header = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  header.setUint32(4, 36 + n * 4, true);
  str(8, "WAVEfmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 2, true);
  header.setUint32(24, sr, true);
  header.setUint32(28, sr * 4, true);
  header.setUint16(32, 4, true);
  header.setUint16(34, 16, true);
  str(36, "data");
  header.setUint32(40, n * 4, true);
  // em blocos: um WAV de 15 min não vira um único array gigante de uma vez
  const parts: BlobPart[] = [header.buffer];
  const CH = 1 << 18;
  for (let s = 0; s < n; s += CH) {
    const len = Math.min(CH, n - s);
    const inter = new Int16Array(len * 2);
    for (let i = 0; i < len; i++) {
      inter[2 * i] = left[s + i];
      inter[2 * i + 1] = right[s + i];
    }
    parts.push(inter.buffer);
  }
  return new Blob(parts, { type: "audio/wav" });
}

// ------------------------------------------------------------------ ZIP (sem compressão)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

async function crc32(blob: Blob): Promise<number> {
  let c = 0xffffffff;
  const CH = 1 << 22;
  for (let s = 0; s < blob.size; s += CH) {
    const b = new Uint8Array(await blob.slice(s, s + CH).arrayBuffer());
    for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP "store" (WAV quase não comprime): abre em qualquer celular e computador. */
export async function zipBlob(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const name = new Uint8Array(enc.encode(f.name));
    const crc = await crc32(f.blob);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nomes em UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, f.blob.size, true);
    local.setUint32(22, f.blob.size, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, f.blob);
    const cd = new DataView(new ArrayBuffer(46 + name.length));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.blob.size, true);
    cd.setUint32(24, f.blob.size, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    new Uint8Array(cd.buffer).set(name, 46);
    central.push(new Uint8Array(cd.buffer));
    offset += 30 + name.length + f.blob.size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
