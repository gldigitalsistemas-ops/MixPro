/**
 * VS pelo servidor: a música sobe (de vídeo, só o áudio), o serviço pesado separa com a mesma IA
 * (HT-Demucs) e devolve as 4 pistas em M4A (leves para baixar no celular). Aqui elas são
 * decodificadas em 44,1 kHz e viram as pistas do VS. Os créditos são debitados só na entrega.
 */
import { fileDuration, runToolJob, toolUpload, ToolError, type ToolHooks } from "@/lib/tools/client";
import { SR, STEMS } from "./demucs";

/** Nome de cada pista no resultado do serviço (apps/export-service/src/tools.ts). */
const SERVER_NAME: Record<(typeof STEMS)[number], string> = { drums: "bateria", bass: "baixo", other: "instrumentos", vocals: "voz" };

function toInt16(a: Float32Array): Int16Array {
  const out = new Int16Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = Math.max(-1, Math.min(1, a[i]));
    out[i] = Math.round(v * 32767);
  }
  return out;
}

async function decode(url: string, signal?: AbortSignal): Promise<[Int16Array, Int16Array]> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new ToolError("INTERNAL", "Não foi possível baixar as pistas separadas. Tente de novo.");
  const data = await res.arrayBuffer();
  // decodifica já em 44,1 kHz (a taxa do VS)
  const ctx = new OfflineAudioContext(2, 1, SR);
  const buf = await ctx.decodeAudioData(data);
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  return [toInt16(l), toInt16(r)];
}

export type ServerStems = { stems: Int16Array[][]; credits: number };

export async function separateOnServer(file: File, maxSeconds: number, onPhase: ToolHooks["onPhase"], signal?: AbortSignal): Promise<ServerStems> {
  onPhase("Lendo a música…", 0);
  const duration = await fileDuration(file);
  if (!duration) throw new ToolError("UNSUPPORTED_FORMAT", "Não conseguimos ler esse arquivo. Envie em MP3, WAV, M4A ou vídeo.");
  if (duration > maxSeconds) throw new ToolError("TOO_LONG", `A música tem mais de ${Math.round(maxSeconds / 60)} minutos. Corte um trecho e tente de novo.`);
  const blob = await toolUpload(file);
  // o andamento do serviço vai até 95%; o resto é baixar e preparar as pistas aqui
  const res = await runToolJob("stems", { format: "m4a", durations: [Math.ceil(duration * 100) / 100] }, [blob], {
    onPhase: (label, p) => onPhase(label, Math.min(90, p * 0.9)),
    signal,
  });
  const stems: Int16Array[][] = [];
  for (const [i, s] of STEMS.entries()) {
    const out = res.outputs.find((o) => o.name.startsWith(`${SERVER_NAME[s]}.`));
    if (!out) throw new ToolError("INTERNAL", "O servidor não devolveu todas as pistas. Tente de novo; nenhum crédito extra será usado.");
    onPhase(`Baixando as pistas (${i + 1} de ${STEMS.length})…`, 90 + (i / STEMS.length) * 10);
    stems.push(await decode(out.url, signal));
  }
  // todas com o mesmo tamanho (o AAC pode variar alguns milissegundos)
  const n = Math.max(...stems.map((s) => s[0].length));
  const even = stems.map((s) =>
    s.map((ch) => {
      if (ch.length === n) return ch;
      const p = new Int16Array(n);
      p.set(ch);
      return p;
    }),
  );
  return { stems: even, credits: res.credits };
}
