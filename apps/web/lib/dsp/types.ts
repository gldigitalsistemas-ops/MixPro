/** Áudio planar: um Float32Array por canal, todos com o mesmo comprimento. */
export type Signal = Float32Array<ArrayBuffer>[];

export const coef = (ms: number, sr: number) => Math.exp(-1 / Math.max(ms * 1e-3 * sr, 1e-6));

export const dbToGain = (db: number) => 10 ** (db / 20);
