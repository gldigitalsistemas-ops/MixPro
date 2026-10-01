"use client";

/**
 * Edição salva no próprio aparelho (IndexedDB): o arquivo original e as escolhas (preset,
 * legendas, filtro, capa, CTA, post…). Se o navegador fechar a página (falta de memória,
 * ligação, troca de app), a pessoa volta e continua de onde parou — sem gerar as legendas de novo.
 * Nada vai para o servidor.
 */

const DB = "mixpro";
const STORE = "session";
const KEY = "current";
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

/** Guarda o arquivo ao abrir (o estado vem depois, a cada mudança). */
export async function saveSessionFile(file: File): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put({ file, savedAt: Date.now(), state: null } satisfies SavedSession, KEY));
  } catch {
    // sem espaço ou navegação privada: segue sem salvar
  }
}

export async function saveSessionState(state: Record<string, unknown>): Promise<void> {
  try {
    const cur = await tx<SavedSession | undefined>("readonly", (s) => s.get(KEY));
    if (!cur) return;
    await tx("readwrite", (s) => s.put({ ...cur, state, savedAt: Date.now() }, KEY));
  } catch {}
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const cur = await tx<SavedSession | undefined>("readonly", (s) => s.get(KEY));
    if (!cur?.file || Date.now() - cur.savedAt > MAX_AGE_MS) return null;
    return cur;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } catch {}
}
