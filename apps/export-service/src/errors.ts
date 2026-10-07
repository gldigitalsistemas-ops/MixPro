/**
 * Códigos de erro FECHADOS do serviço. São a única informação de erro que vai para o banco e para
 * os logs: nunca texto do FFmpeg, do arquivo ou do job.
 */
import type { DecodeErrorCode } from "@/lib/export/ffmpeg-decode";

export const ERROR_CODES = [
  // job
  "JOB_NOT_FOUND",
  "INVALID_JOB",
  "OUT_OF_SCOPE",
  "TOO_LONG",
  "TOO_LARGE",
  "LIMIT",
  "REF_INVALID",
  "VERSION_MISMATCH",
  // entrada
  "INPUT_MISSING",
  "UNSUPPORTED_FORMAT",
  "UNSUPPORTED_LAYOUT",
  "CORRUPT_INPUT",
  "TRUNCATED_INPUT",
  "NO_AUDIO",
  "DURATION_MISMATCH",
  "RATE_MISMATCH",
  "CHANNELS_MISMATCH",
  "START_MISMATCH",
  // processamento
  "ASSET_NOT_FOUND",
  "ASSET_FAILED",
  "ENCODE_FAILED",
  "STORAGE_FAILED",
  "TIMEOUT",
  "INTERNAL",
  // banco e crédito (fatia 4)
  "REF_MISMATCH",
  "INSUFFICIENT_CREDITS",
  "RATE_LIMITED",
  "CAPACITY",
  "CANCELLED",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Erro que já carrega o código fechado. */
export class JobError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
    this.name = "JobError";
  }
}

/** Falhas que podem passar numa nova tentativa (rede, armazenamento); as outras são definitivas. */
export const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["ASSET_FAILED", "STORAGE_FAILED", "TIMEOUT", "INTERNAL"]);

export const fromDecode = (c: DecodeErrorCode): ErrorCode =>
  ({
    no_audio: "NO_AUDIO",
    unsupported: "UNSUPPORTED_FORMAT",
    codec: "UNSUPPORTED_FORMAT",
    layout: "UNSUPPORTED_LAYOUT",
    too_long: "TOO_LONG",
    decode: "CORRUPT_INPUT",
    truncated: "TRUNCATED_INPUT",
    timeout: "TIMEOUT",
  })[c] as ErrorCode;
