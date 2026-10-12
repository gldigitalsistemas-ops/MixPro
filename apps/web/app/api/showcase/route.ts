import { publicItems } from "@/lib/premium/showcase";

/** Vitrine pública (só itens aprovados). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const items = await publicItems({ product: u.searchParams.get("produto"), genre: u.searchParams.get("genero"), limit: Number(u.searchParams.get("limite") ?? 24) || 24 });
  return Response.json({ items }, { headers: { "Cache-Control": "private, max-age=300" } });
}
