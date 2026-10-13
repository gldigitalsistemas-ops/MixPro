import { withUser } from "@/lib/api";
import { shareStudio } from "@/lib/premium/showcase";
import { smallJson } from "@/lib/premium/route-helpers";

/** Autoriza na vitrine o antes e depois do Estúdio (a partir do link de 24 h que a pessoa acabou de criar). */
export async function POST(req: Request) {
  const body = await smallJson<Record<string, unknown>>(req, 4000);
  return withUser(async (userId) => {
    const r = await shareStudio(userId, body ?? {});
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ item_id: r.id });
  });
}
