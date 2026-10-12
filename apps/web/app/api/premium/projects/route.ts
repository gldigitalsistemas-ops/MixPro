import { withUser } from "@/lib/api";
import { premiumDeps } from "@/lib/export/server-deps";
import { createProject } from "@/lib/premium/server";
import { exportServerConfigured, failResponse, smallJson, unavailableResponse } from "@/lib/premium/route-helpers";

/** Cria um projeto premium e devolve uma URL de envio por arquivo (direto para o Cofre do projeto). */
export async function POST(req: Request) {
  const body = await smallJson<{ product?: string; title?: string; files?: { name: string; bytes: number; role?: string }[]; parent_id?: string }>(req);
  return withUser(async (userId) => {
    if (!exportServerConfigured()) return unavailableResponse();
    const r = await createProject(premiumDeps(req), userId, { product: String(body?.product ?? ""), title: body?.title, files: Array.isArray(body?.files) ? body!.files : [], parentId: body?.parent_id ?? null });
    if (!r.ok) return failResponse(r);
    return Response.json({ project_id: r.projectId, uploads: r.uploads });
  });
}
