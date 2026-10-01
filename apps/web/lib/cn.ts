import clsx, { type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

/** Todo o app mostra datas no horário de Brasília (o servidor roda em UTC). */
export const TIME_ZONE = "America/Sao_Paulo";

export function formatDate(iso: string | number | null | undefined): string {
  if (iso == null || iso === "") return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIME_ZONE });
}

export function formatDateTime(iso: string | number | null | undefined): string {
  if (iso == null || iso === "") return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
}

/** Começo do mês atual no horário de Brasília (UTC-3, sem horário de verão desde 2019). */
export function startOfMonthBrasilia(now = new Date()): Date {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1, 3));
}
