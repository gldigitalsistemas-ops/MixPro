"use client";

/**
 * Edição salva no próprio aparelho (IndexedDB): o arquivo original e as escolhas (preset,
 * legendas, filtro, capa, CTA, post…). Se o navegador fechar a página (falta de memória,
 * ligação, troca de app), a pessoa volta e continua de onde parou — sem gerar as legendas de novo.
 * Nada vai para o servidor.
 */

const DB = "mixpro";
const STORE = "session";
/** O arquivo fica num registro e o estado em outro: salvar o estado (a cada mudança) não regrava o vídeo. */
const FILE_KEY = "file";
const STATE_KEY = "state";
/** Formato antigo (arquivo e estado juntos). */
const LEGACY_KEY = "current";
/** Edição mais antiga que isso não é oferecida de volta. */
const MAX_AGE_MS = 7 * 24 * 3600_000;

export type SavedSession = {
  file: File;
  savedAt: number;
  /** Estado do estúdio (só dados simples: nada de áudio decodificado). */
  state: Record<string, unknown> | null;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Guarda o arquivo uma vez, depois de aberto (a sessão anterior já foi apagada por clearSession).
 * Devolve o erro (sem espaço, modo privado) para registro. */
export async function saveSessionFile(file: File): Promise<Error | null> {
  try {
    await tx("readwrite", (s) => s.put({ file, savedAt: Date.now() }, FILE_KEY));
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

/** Estado da edição (registro pequeno, gravado a cada mudança). */
export async function saveSessionState(state: Record<string, unknown>): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put({ state, savedAt: Date.now() }, STATE_KEY));
  } catch {}
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const f = await tx<{ file: File; savedAt: number } | undefined>("readonly", (s) => s.get(FILE_KEY));
    if (f?.file) {
      const st = await tx<{ state: Record<string, unknown>; savedAt: number } | undefined>("readonly", (s) => s.get(STATE_KEY));
      const savedAt = Math.max(f.savedAt, st?.savedAt ?? 0);
      if (Date.now() - savedAt > MAX_AGE_MS) return null;
      return { file: f.file, savedAt, state: st?.state ?? null };
    }
    const old = await tx<SavedSession | undefined>("readonly", (s) => s.get(LEGACY_KEY));
    if (!old?.file || Date.now() - old.savedAt > MAX_AGE_MS) return null;
    return old;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    for (const k of [FILE_KEY, STATE_KEY, LEGACY_KEY]) await tx("readwrite", (s) => s.delete(k));
  } catch {}
}
