/**
 * Avisa o site quando um job termina (o site manda a notificação ao celular). Chamada assinada com HMAC da chave
 * de serviço do Supabase (a mesma que o site tem), então não há segredo novo. Nunca derruba o job: erro ou demora
 * viram "não avisou". O endereço do site vem de APP_URL ou de system_settings.app_url (público).
 */
import { createHmac } from "node:crypto";

export type Notifier = (jobId: string) => Promise<void>;

export function makeNotifier(o: { supabaseUrl: string; anonKey: string; serviceKey: string; appUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number }): Notifier {
  const f = o.fetchFn ?? fetch;
  let base: string | null = o.appUrl?.replace(/\/+$/, "") || null;
  const timeout = o.timeoutMs ?? 4000;
  return async (jobId) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      if (!base) {
        const r = await f(`${o.supabaseUrl.replace(/\/$/, "")}/rest/v1/system_settings?key=eq.app_url&select=value`, { headers: { apikey: o.anonKey }, signal: ctrl.signal });
        const v = r.ok ? ((await r.json()) as { value?: unknown }[])[0]?.value : null;
        if (typeof v === "string" && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v.replace(/\/+$/, ""))) base = v.replace(/\/+$/, "");
      }
      if (!base) return;
      const token = createHmac("sha256", o.serviceKey).update(`notify:${jobId}`).digest("hex");
      await f(`${base}/api/internal/job-done`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job_id: jobId, token }), signal: ctrl.signal });
    } catch {
      // sem aviso: o resultado continua disponível em Meus projetos
    } finally {
      clearTimeout(t);
    }
  };
}
