import { PREMIUM_IDS, type PremiumId } from "@mixpro/contracts";
import { withUser } from "@/lib/api";
import { premiumDeps } from "@/lib/export/server-deps";
import { quote } from "@/lib/premium/server";

/** Preço para a pessoa: 1ª experiência (se ainda pode usar) e o preço normal (com desconto Pro). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const product = u.searchParams.get("product") ?? "";
  const minutes = Math.max(0, Math.min(20, Number(u.searchParams.get("minutes") ?? 0) || 0));
  if (!(PREMIUM_IDS as readonly string[]).includes(product)) return Response.json({ error: "Produto inválido." }, { status: 400 });
  return withUser(async (userId) => Response.json(await quote(premiumDeps(req), userId, product as PremiumId, minutes)));
}
