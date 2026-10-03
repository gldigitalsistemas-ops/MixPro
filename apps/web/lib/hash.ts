/**
 * Hashes FNV-1a de 32 bits usados como chaves (cache, p_ref, sessões salvas).
 *
 * Há duas variantes que NÃO são intercambiáveis: elas percorrem o texto de jeitos diferentes e
 * escrevem o resultado em bases diferentes. Cada uma já gerou chaves gravadas (p_ref no banco,
 * sessões do VS no aparelho), então trocar uma pela outra mudaria essas chaves.
 */

/**
 * Exportação do estúdio (p_ref, cache do áudio): percorre por caractere Unicode (code point),
 * usa a primeira unidade UTF-16 de cada um e escreve em hexadecimal com 8 dígitos.
 */
export function fnvHex(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** VS: percorre cada unidade UTF-16 e escreve em base 36. */
export function fnv36(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * Impressão digital do conteúdo de um áudio (independe do nome do arquivo): FNV-1a sobre os bytes
 * de até 65 536 amostras espaçadas por canal, mais o tamanho. Rápida até para 10 min de áudio.
 */
export function signalFingerprint(channels: readonly Float32Array[]): string {
  let h = 0x811c9dc5;
  const mix = (byte: number) => {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  };
  const n = channels[0]?.length ?? 0;
  for (const b of new TextEncoder().encode(`${channels.length}x${n}`)) mix(b);
  const step = Math.max(1, Math.floor(n / 65536));
  const one = new Float32Array(1);
  const bytes = new Uint8Array(one.buffer);
  for (const ch of channels) {
    for (let i = 0; i < n; i += step) {
      one[0] = ch[i];
      for (let k = 0; k < 4; k++) mix(bytes[k]);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
