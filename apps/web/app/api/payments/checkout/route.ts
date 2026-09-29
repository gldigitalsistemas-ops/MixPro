import { z } from "zod";
import { getSession } from "@/lib/supabase/server";
import { jsonError } from "@/lib/errors";
import { loadSettings, num, withUser } from "@/lib/api";
import { createCheckout } from "@/lib/payments";

const bodySchema = z.object({ credits: z.number().int().positive() });

/** Compra de créditos: o usuário escolhe a quantidade; preço = quantidade × preço do crédito. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return withUser(async (userId) => {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Informe a quantidade de créditos.");

    const settings = await loadSettings();
    const min = num(settings, "credit_purchase_min", 5);
    const max = num(settings, "credit_purchase_max", 500);
    const price = num(settings, "download_price_brl", 1);
    const credits = parsed.data.credits;
    if (credits < min || credits > max) return jsonError(400, `Escolha entre ${min} e ${max} créditos.`);

    const session = await getSession();
    try {
      const checkout = await createCheckout({
        userId,
        email: session?.email ?? null,
        packId: `credits:${credits}`,
        title: `Mix Pro — crédito de download`,
        quantity: credits,
        unitPrice: price,
        credits,
        returnPath: "/creditos",
      });
      return Response.json({ init_point: checkout.initPoint });
    } catch (e) {
      console.error("[checkout]", e);
      return jsonError(502, "Não foi possível abrir o pagamento agora. Tente novamente em instantes.");
    }
  });
}
