/**
 * Aviso "ficou pronto": o serviço de processamento chama a rota quando um job termina; a rota confere a
 * assinatura e manda uma notificação curta ao dono (só o status, nunca o conteúdo).
 *
 * Assinatura: HMAC-SHA256(chave de serviço do Supabase, "notify:" + job_id) em hexadecimal. As duas pontas já têm
 * essa chave, então não existe segredo novo para configurar e a chave nunca viaja.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PushMessage } from "./messages";

export const notifyToken = (secret: string, jobId: string) => createHmac("sha256", secret).update(`notify:${jobId}`).digest("hex");

export function validNotifyToken(secret: string, jobId: string, token: unknown): boolean {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return false;
  const a = Buffer.from(notifyToken(secret, jobId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const TOOL_NAME: Record<string, string> = {
  pitch_tempo: "Tom e andamento",
  voice_playback: "Voz + Playback",
  reference_master: "Masterização por referência",
  album: "Modo álbum",
  stems: "Separação de faixas",
  convert: "Conversão",
  stems_premium: "VS Premium",
  mix_ia: "Mix & Master IA",
  compose: "Produção da composição",
  voice_final: "Voz finalizada",
};

export type DoneJob = { tool: string; status: "done" | "failed"; preview: boolean; projectId: string | null; wallMs: number };

/** Texto da notificação (null = não avisar: conversão rápida ou job curto que a pessoa ainda está olhando). */
export function jobDoneMessage(j: DoneJob): PushMessage | null {
  if (j.tool === "convert") return null;
  const name = TOOL_NAME[j.tool] ?? "Seu pedido";
  // jobs curtos terminam enquanto a pessoa ainda está na tela
  if (j.wallMs < 20_000 && !j.projectId) return null;
  const url = j.projectId ? `/premium/${j.projectId}` : "/projetos";
  if (j.status === "failed") return { title: `${name}: não deu certo desta vez`, body: "Nada foi cobrado. Toque para ver o que fazer.", url };
  return j.preview
    ? { title: `A prévia da ${name} ficou pronta 🎧`, body: "Ouça os 30 segundos e decida se quer a música inteira.", url }
    : { title: `${name} ficou pronta ✅`, body: "Seus arquivos estão prontos para baixar.", url };
}
