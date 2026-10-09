/**
 * Cria a página antes/depois: codifica os dois trechos (até 30 s, em M4A; WAV se o navegador não
 * gerar AAC), pede o link ao servidor e envia os dois direto ao R2.
 */
import { encodeAudio } from "@/lib/media/export";
import { put } from "@/lib/export/server-client";
import type { Signal } from "@/lib/dsp/types";

export const SHARE_CLIP_S = 30;

const fromBuffer = (b: AudioBuffer, maxS: number): Signal => {
  const n = Math.min(b.length, Math.round(maxS * b.sampleRate));
  return Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice(0, n)) as Signal;
};

async function encodeClip(b: AudioBuffer): Promise<{ blob: Blob; ext: "m4a" | "wav" }> {
  const ch = fromBuffer(b, SHARE_CLIP_S);
  try {
    return { blob: await encodeAudio(ch, b.sampleRate, "m4a"), ext: "m4a" };
  } catch {
    return { blob: await encodeAudio(ch, b.sampleRate, "wav"), ext: "wav" };
  }
}

export type ShareRequest = { before: AudioBuffer; after: AudioBuffer; title: string; preset: string; lufsBefore: number | null; lufsAfter: number | null };

/** Devolve o link público (vale 24 h). */
export async function createShareLink(r: ShareRequest, onProgress: (v: number) => void = () => {}): Promise<string> {
  onProgress(0.05);
  let a = await encodeClip(r.before);
  let b = await encodeClip(r.after);
  // os dois precisam do mesmo formato (a página toca os dois juntos)
  if (a.ext !== b.ext) {
    a = { blob: await encodeAudio(fromBuffer(r.before, SHARE_CLIP_S), r.before.sampleRate, "wav"), ext: "wav" };
    b = { blob: await encodeAudio(fromBuffer(r.after, SHARE_CLIP_S), r.after.sampleRate, "wav"), ext: "wav" };
  }
  onProgress(0.3);
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: r.title, preset: r.preset, ext: a.ext, bytes: [a.blob.size, b.blob.size], lufs_before: r.lufsBefore, lufs_after: r.lufsAfter }),
  });
  const body = (await res.json().catch(() => null)) as { url?: string; uploads?: { a: string; b: string }; error?: string } | null;
  if (!res.ok || !body?.uploads || !body.url) throw new Error(body?.error ?? "Não foi possível criar o link agora.");
  const xhr = () => new XMLHttpRequest();
  await put(body.uploads.a, a.blob, (p) => onProgress(0.3 + p * 0.35), undefined, xhr);
  await put(body.uploads.b, b.blob, (p) => onProgress(0.65 + p * 0.35), undefined, xhr);
  return new URL(body.url, window.location.origin).toString();
}
