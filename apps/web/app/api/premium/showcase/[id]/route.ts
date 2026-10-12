import { withUser } from "@/lib/api";
import { revokeItem } from "@/lib/premium/showcase";

/** O dono retira a autorização: o trecho sai da vitrine e os arquivos são apagados. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/premium/showcase/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Não encontrado." }, { status: 404 });
  return withUser(async (userId) => ((await revokeItem(userId, id)) ? Response.json({ ok: true }) : Response.json({ error: "Não encontrado." }, { status: 404 })));
}
