import "server-only";
import { z } from "zod";

/** Variáveis somente do servidor — nunca chegam ao navegador. */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

let cached: z.infer<typeof serverSchema> | null = null;

export function serverEnv() {
  if (!cached) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Configuração do servidor incompleta: ${missing}. Veja apps/web/.env.example`);
    }
    cached = parsed.data;
  }
  return cached;
}
