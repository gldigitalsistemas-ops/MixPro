import "server-only";
import { R2Client, r2ConfigFromEnv } from "@/lib/export/r2";
import type { ProObjects } from "./uploads";

/** R2 real para os arquivos da Mixagem Profissional. Sem R2 configurado: null (o app pede o link). */
export function proObjects(): ProObjects | null {
  let r2: R2Client;
  try {
    r2 = new R2Client(r2ConfigFromEnv());
  } catch {
    return null;
  }
  return {
    presign: (method, key, expiresS, opts) => r2.presign(method, key, expiresS, opts),
    put: (key, data) => r2.put(key, data),
    get: async (key) => {
      const r = r2.sign("GET", key);
      const res = await fetch(r.url, { headers: r.headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`r2 get ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
