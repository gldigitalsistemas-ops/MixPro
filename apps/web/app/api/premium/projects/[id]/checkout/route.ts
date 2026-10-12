import { withUser } from "@/lib/api";
import { premiumDeps } from "@/lib/export/server-deps";
import { clientIp } from "@/lib/premium/identity";
import { checkout } from "@/lib/premium/server";
import { currentEmail, failResponse, smallJson } from "@/lib/premium/route-helpers";

/**
 * Pagamento do projeto: em reais (abre o Mercado Pago) ou em créditos (paga na hora e começa).
 * Com a 1ª experiência, o app envia o identificador do aparelho, a assinatura do navegador e o CPF;
 * o servidor guarda só hashes.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/premium/projects/[id]/checkout">) {
  const { id } = await ctx.params;
  const body = await smallJson<{ product?: string; method?: string; use_intro?: boolean; device_id?: string; cpf?: string; fingerprint?: string }>(req);
  return withUser(async (userId) => {
    const { email, confirmed } = await currentEmail();
    const r = await checkout(premiumDeps(req), userId, id, {
      product: body?.product,
      method: body?.method === "credits" ? "credits" : "brl",
      useIntro: body?.use_intro === true,
      deviceId: body?.device_id,
      cpf: body?.cpf,
      fingerprint: body?.fingerprint,
      ip: clientIp(req.headers),
      email,
      emailConfirmed: confirmed,
    });
    if (!r.ok) return failResponse(r);
    return Response.json({ order_id: r.orderId, paid: r.paid, init_point: r.initPoint, quote: r.quote });
  });
}
