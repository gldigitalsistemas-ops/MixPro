/** Aviso de arquivos que vão expirar (Cofre de 30 dias). Só vale para projetos entregues. */
export const WARN_DAYS = 3;

/** Dias inteiros que faltam (0 = hoje; negativo = já passou). */
export function daysLeft(expiresAt: string, now: number = Date.now()): number {
  return Math.floor((new Date(expiresAt).getTime() - now) / 86_400_000);
}

export function expiringSoon(status: string, expiresAt: string, now: number = Date.now()): boolean {
  if (status !== "delivered") return false;
  const t = new Date(expiresAt).getTime();
  return t > now && daysLeft(expiresAt, now) < WARN_DAYS;
}
