import { withUser } from "@/lib/api";
import { exportDeps, exportServerConfigured } from "@/lib/export/server-deps";
import { serverEnabled } from "@/lib/export/server-jobs";

/** O app só tenta o servidor quando ele está configurado e liberado para este usuário. */
export async function GET() {
  return withUser(async (userId) => {
    try {
      // só oferece o servidor quando a fila também está configurada (senão o job criado não andaria)
      if (!exportServerConfigured()) return Response.json({ enabled: false });
      return Response.json({ enabled: await serverEnabled(exportDeps(), userId) });
    } catch {
      return Response.json({ enabled: false });
    }
  });
}
