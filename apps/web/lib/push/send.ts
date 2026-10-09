/**
 * Envio da notificação diária. Separado da rota para ser testado com um "enviador" falso.
 * Regras: uma vez por dia por navegador; quem já baixou algo hoje não recebe; inscrição que o serviço
 * de push diz não existir mais (404/410) é apagada; muitas falhas seguidas também.
 */
import type { PushMessage } from "./messages";
import { smartMessage, type UserContext } from "./smart";

export type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id: string | null; failures: number };
export type Sender = (sub: Sub, payload: string) => Promise<{ status: number }>;
export type Store = {
  due(limit: number): Promise<Sub[]>;
  activeToday(userIds: string[]): Promise<Set<string>>;
  markSent(ids: string[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  bumpFailures(subs: Sub[]): Promise<void>;
  /** Sinais para o lembrete inteligente (opcional: sem ele, todos recebem a mensagem do dia). */
  context?(userIds: string[]): Promise<Map<string, UserContext>>;
};

export const MAX_FAILURES = 5;

export async function sendDaily(store: Store, send: Sender, msg: PushMessage, opts: { limit?: number; concurrency?: number } = {}) {
  const subs = await store.due(opts.limit ?? 2000);
  const users = [...new Set(subs.map((s) => s.user_id).filter((v): v is string => Boolean(v)))];
  const active = users.length ? await store.activeToday(users) : new Set<string>();
  const targets = subs.filter((s) => !s.user_id || !active.has(s.user_id));
  const ctx = users.length && store.context ? await store.context(users.filter((u) => !active.has(u))).catch(() => new Map<string, UserContext>()) : new Map<string, UserContext>();
  const payloadFor = (s: Sub) => JSON.stringify(s.user_id ? smartMessage(ctx.get(s.user_id), msg) : msg);
  const sent: string[] = [];
  const gone: string[] = [];
  const failed: Sub[] = [];
  let i = 0;
  const worker = async () => {
    while (i < targets.length) {
      const s = targets[i++];
      try {
        const r = await send(s, payloadFor(s));
        if (r.status >= 200 && r.status < 300) sent.push(s.id);
        else if (r.status === 404 || r.status === 410) gone.push(s.id);
        else failed.push(s);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
        else failed.push(s);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 25, targets.length || 1) }, worker));
  const dead = failed.filter((s) => s.failures + 1 >= MAX_FAILURES).map((s) => s.id);
  if (sent.length) await store.markSent(sent);
  if (gone.length || dead.length) await store.remove([...gone, ...dead]);
  const retry = failed.filter((s) => s.failures + 1 < MAX_FAILURES);
  if (retry.length) await store.bumpFailures(retry);
  return { candidatos: subs.length, pulados_ativos: subs.length - targets.length, enviados: sent.length, removidos: gone.length + dead.length, falhas: retry.length };
}
