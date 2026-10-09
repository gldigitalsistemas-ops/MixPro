import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/server";
import { messageForDay } from "@/lib/push/messages";
import { sendDaily, type Store, type Sub } from "@/lib/push/send";

export const maxDuration = 60;

/** Início do dia de hoje no horário de Brasília (UTC-3). */
function startOfDayBrt(now = new Date()): string {
  const brt = new Date(now.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), 3)).toISOString();
}

/**
 * Notificação diária (agendada em vercel.json). Só a Vercel chama: o cabeçalho Authorization traz o
 * CRON_SECRET. Variáveis: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("não autorizado", { status: 401 });
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return Response.json({ ok: false, motivo: "VAPID não configurado" }, { status: 503 });

  const admin = supabaseAdmin();
  const { data: setting } = await admin.from("system_settings").select("value").eq("key", "push_daily_enabled").maybeSingle();
  if (setting && String(setting.value) === "false") return Response.json({ ok: true, desligado: true });

  webpush.setVapidDetails(subject, pub, priv);
  const today = startOfDayBrt();
  // ?teste=1: só as inscrições de administradores, sem a regra do dia e sem marcar como enviado
  const test = new URL(req.url).searchParams.get("teste") === "1";
  const admins = test ? ((await admin.from("profiles").select("id").eq("role", "admin")).data ?? []).map((r) => r.id as string) : [];
  const store: Store = {
    due: async (limit) => {
      if (test) {
        if (!admins.length) return [];
        const { data } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id,failures").in("user_id", admins).limit(20);
        return (data ?? []) as Sub[];
      }
      const { data } = await admin
        .from("push_subscriptions")
        .select("id,endpoint,p256dh,auth,user_id,failures")
        .or(`last_sent_at.is.null,last_sent_at.lt.${today}`)
        .order("created_at")
        .limit(limit);
      return (data ?? []) as Sub[];
    },
    activeToday: async (ids) => {
      if (test) return new Set<string>();
      const { data } = await admin.from("credit_transactions").select("user_id").in("user_id", ids).eq("type", "DOWNLOAD").gte("created_at", today);
      return new Set((data ?? []).map((r) => r.user_id as string));
    },
    markSent: async (ids) => {
      if (test) return;
      await admin.from("push_subscriptions").update({ last_sent_at: new Date().toISOString(), failures: 0 }).in("id", ids);
    },
    remove: async (ids) => {
      await admin.from("push_subscriptions").delete().in("id", ids);
    },
    bumpFailures: async (subs) => {
      for (const s of subs) await admin.from("push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
    },
  };
  const result = await sendDaily(
    store,
    (s, payload) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600, urgency: "normal" }).then((r) => ({ status: r.statusCode })),
    messageForDay(),
  );
  return Response.json({ ok: true, ...result });
}
