import { withUser } from "@/lib/api";
import { exportDeps } from "@/lib/export/server-deps";
import { serverEnabled } from "@/lib/export/server-jobs";

/** O app só tenta o servidor quando ele está configurado e liberado para este usuário. */
export async function GET() {
  return withUser(async (userId) => {
    try {
      return Response.json({ enabled: await serverEnabled(exportDeps(), userId) });
    } catch {
      return Response.json({ enabled: false });
    }
  });
}
