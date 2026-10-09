/**
 * Mensagens para a pessoa, por código fechado do servidor de exportação (nunca texto técnico).
 * `device`: o aparelho consegue processar este caso; a tela oferece "Processar no aparelho".
 * `status`: HTTP das rotas.
 */
export type ExportErrorInfo = { message: string; device: boolean; status: number };

const GENERIC_TRY_DEVICE = "Não conseguimos processar no servidor agora. Você pode processar neste aparelho.";

export const EXPORT_ERRORS: Record<string, ExportErrorInfo> = {
  INSUFFICIENT_CREDITS: { message: "Você não tem créditos suficientes para baixar. Compre créditos para continuar.", device: false, status: 402 },
  RATE_LIMITED: { message: "Você fez muitas exportações seguidas. Espere um pouco ou processe neste aparelho.", device: true, status: 429 },
  CAPACITY: { message: "O processamento no servidor está ocupado ou desligado agora. Você pode processar neste aparelho.", device: true, status: 503 },
  REF_MISMATCH: { message: "Este pedido já foi pago com outro áudio. Você pode processar neste aparelho.", device: true, status: 409 },
  CANCELLED: { message: "O processamento foi cancelado.", device: false, status: 409 },
  INVALID_JOB: { message: "Não conseguimos entender este pedido. Você pode processar neste aparelho.", device: true, status: 422 },
  OUT_OF_SCOPE: { message: "Este tipo de pedido ainda não roda no servidor. Você pode processar neste aparelho.", device: true, status: 422 },
  LIMIT: { message: "Este pedido tem mais ajustes do que o servidor aceita. Você pode processar neste aparelho.", device: true, status: 422 },
  REF_INVALID: { message: "Não conseguimos confirmar este pedido. Você pode processar neste aparelho.", device: true, status: 422 },
  VERSION_MISMATCH: { message: "O app foi atualizado. Recarregue a página e tente de novo.", device: false, status: 409 },
  TOO_LARGE: { message: "Arquivo grande demais para o servidor. Você pode processar neste aparelho.", device: true, status: 413 },
  TOO_LONG: { message: "Áudio longo demais para o servidor (até 10 minutos). Você pode processar neste aparelho.", device: true, status: 422 },
  UNSUPPORTED_FORMAT: { message: "O formato parece não ser compatível. Tente MP3, WAV, M4A ou MP4.", device: false, status: 422 },
  UNSUPPORTED_LAYOUT: { message: "Este áudio tem uma configuração de canais que não suportamos. Tente exportar de outro programa.", device: false, status: 422 },
  CORRUPT_INPUT: { message: "O arquivo parece estar danificado. Tente enviar de novo ou use outro arquivo.", device: false, status: 422 },
  TRUNCATED_INPUT: { message: "O envio ficou incompleto. Tente enviar de novo.", device: false, status: 422 },
  NO_AUDIO: { message: "Não encontramos áudio neste arquivo.", device: false, status: 422 },
  INPUT_MISSING: { message: "O arquivo não chegou ao servidor. Tente enviar de novo.", device: false, status: 409 },
  DURATION_MISMATCH: { message: GENERIC_TRY_DEVICE, device: true, status: 422 },
  RATE_MISMATCH: { message: GENERIC_TRY_DEVICE, device: true, status: 422 },
  CHANNELS_MISMATCH: { message: GENERIC_TRY_DEVICE, device: true, status: 422 },
  START_MISMATCH: { message: GENERIC_TRY_DEVICE, device: true, status: 422 },
  ASSET_NOT_FOUND: { message: GENERIC_TRY_DEVICE, device: true, status: 422 },
  ASSET_FAILED: { message: GENERIC_TRY_DEVICE, device: true, status: 503 },
  ENCODE_FAILED: { message: GENERIC_TRY_DEVICE, device: true, status: 500 },
  STORAGE_FAILED: { message: GENERIC_TRY_DEVICE, device: true, status: 503 },
  TIMEOUT: { message: "O processamento demorou mais do que o permitido. Você pode processar neste aparelho.", device: true, status: 504 },
  INTERNAL: { message: GENERIC_TRY_DEVICE, device: true, status: 500 },
  JOB_NOT_FOUND: { message: "Pedido não encontrado.", device: false, status: 404 },
  NEEDS_PURCHASE: { message: "Você já usou a separação de faixas grátis. Compre créditos ou assine um plano para separar mais músicas.", device: false, status: 402 },
  PRO_ONLY: { message: "WAV 24 bits e FLAC são do Plano Pro. Escolha MP3, WAV ou M4A, ou assine o Pro.", device: false, status: 403 },
  TOOL_UNAVAILABLE: { message: "Este recurso está temporariamente indisponível. Tente de novo em alguns minutos.", device: false, status: 503 },
};

/** Código desconhecido vira INTERNAL: nunca mostra texto bruto. */
export function exportErrorInfo(code: string | null | undefined): ExportErrorInfo {
  return (code && EXPORT_ERRORS[code]) || EXPORT_ERRORS.INTERNAL;
}
