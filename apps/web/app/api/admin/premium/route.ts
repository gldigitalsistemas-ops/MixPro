import { withAdmin } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/server";
import { premiumDeps } from "@/lib/export/server-deps";
import { refundPayment } from "@/lib/payments";
import { startFinal } from "@/lib/premium/server";

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Operação da Produção (só admin):
 *   POST { action: "refund", order_id, note? }  devolve o valor (Mercado Pago, se foi em reais; créditos, se foi em créditos),
 *                                               corta o acesso aos arquivos e encerra o projeto
 *   POST { action: "redo", project_id }         refaz o trabalho completo de um projeto já pago, sem cobrar de novo
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { action?: string; order_id?: unknown; project_id?: unknown; note?: unknown } | null;
  return withAdmin(async () => {
    const admin = supabaseAdmin();
    if (body?.action === "refund" && typeof body.order_id === "string" && UUID.test(body.order_id)) {
      const { data: o } = await admin.from("premium_orders").select("id,status,method,price_brl,payment_order_id").eq("id", body.order_id).maybeSingle();
      if (!o) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
      if (o.status === "refunded") return Response.json({ ok: true, ja_estornado: true });
      if (o.status !== "paid") return Response.json({ error: "Só dá para estornar pedidos pagos." }, { status: 409 });
      let returned = "créditos devolvidos";
      if (o.method === "brl" && Number(o.price_brl) > 0) {
        const { data: po } = await admin.from("payment_orders").select("mp_payment_id").eq("id", o.payment_order_id ?? "").maybeSingle();
        if (!po?.mp_payment_id) return Response.json({ error: "Este pedido não tem pagamento do Mercado Pago ligado. Devolva pelo painel do Mercado Pago e use “Encerrar” depois." }, { status: 409 });
        try {
          await refundPayment(String(po.mp_payment_id), `prem-refund-${o.id}`);
        } catch (e) {
          return Response.json({ error: `O Mercado Pago recusou o estorno: ${String(e).slice(0, 160)}` }, { status: 502 });
        }
        returned = "valor devolvido pelo Mercado Pago";
      }
      const { error } = await admin.rpc("refund_premium_order", { p_order: o.id, p_note: typeof body.note === "string" ? body.note.slice(0, 300) : "" });
      if (error) return Response.json({ error: "O estorno foi feito no Mercado Pago, mas o pedido não pôde ser encerrado aqui. Tente de novo." }, { status: 500 });
      return Response.json({ ok: true, resultado: returned });
    }
    if (body?.action === "redo" && typeof body.project_id === "string" && UUID.test(body.project_id)) {
      const { data, error } = await admin.rpc("redo_premium_project", { p_project: body.project_id });
      if (error) return Response.json({ error: String(error.message).includes("NOT_PAID") ? "O projeto não tem pedido pago." : "Não foi possível refazer." }, { status: 409 });
      const owner = (data as { user_id: string }).user_id;
      const r = await startFinal(premiumDeps(req), owner, body.project_id);
      if (!r.ok) return Response.json({ error: `Preparado, mas o processamento não iniciou: ${r.message}` }, { status: 502 });
      return Response.json({ ok: true, job_id: r.jobId });
    }
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  });
}
