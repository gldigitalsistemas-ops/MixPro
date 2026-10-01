"use client";

/**
 * Acesso ao arquivo escolhido pelo usuário. No iPhone, o vídeo escolhido na Galeria é uma cópia
 * temporária que o sistema pode apagar (ao limpar o campo de arquivo, sob pouca memória ou se o vídeo
 * ainda estava no iCloud). Aí qualquer leitura falha com "NotFoundError".
 */
import { loadSession } from "@/lib/session-store";

/** Abre o seletor de arquivos. Limpa o campo antes (e não depois da escolha) para poder escolher o mesmo arquivo de novo. */
export function openPicker(input: HTMLInputElement | null) {
  if (!input) return;
  input.value = "";
  input.click();
}

/** O arquivo sumiu do aparelho (cópia temporária apagada) ou não pode ser lido. */
export function isFileGone(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? "";
  const msg = String((err as { message?: string } | null)?.message ?? err);
  return name === "NotFoundError" || name === "NotReadableError" || /can ?not be found|could not be found|not readable/i.test(msg);
}

async function readable(file: File): Promise<boolean> {
  try {
    await file.slice(0, 64).arrayBuffer();
    await file.slice(Math.max(0, file.size - 64)).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/**
 * Devolve um arquivo que ainda pode ser lido: o original ou, se o iPhone apagou a cópia temporária,
 * a cópia guardada no aparelho para recuperar a edição. Null se nenhum dos dois existir mais.
 */
export async function readableFile(file: File): Promise<File | null> {
  if (await readable(file)) return file;
  const saved = await loadSession();
  if (saved?.file && saved.file.name === file.name && saved.file.size === file.size && (await readable(saved.file))) return saved.file;
  return null;
}
