/** Tradução dos códigos de erro do banco/API para mensagens ao usuário. */
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Sua sessão expirou. Entre novamente.",
  INSUFFICIENT_CREDITS: "Você não tem downloads disponíveis. Adquira mais créditos para baixar.",
  RATE_LIMITED: "Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente de novo.",
  SOURCE_NOT_READY: "O áudio ainda está sendo analisado. Aguarde um instante.",
  SOURCE_NOT_FOUND: "O áudio original não foi encontrado.",
  TRACK_NOT_FOUND: "Pista não encontrada.",
  PRESET_NOT_AVAILABLE: "Este preset não está disponível no momento.",
  FILE_NOT_FOUND: "Arquivo não encontrado ou expirado.",
  FILE_NOT_DOWNLOADABLE: "Este arquivo não pode ser baixado.",
  INVALID_FORMAT: "Formato de exportação inválido.",
  PROJECT_NOT_FOUND: "Projeto não encontrado.",
  FORBIDDEN: "Você não tem permissão para esta ação.",
};

export function friendlyError(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "";
  for (const [code, msg] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return msg;
  }
  return "Algo deu errado. Tente novamente em instantes.";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}
