"use client";

/**
 * Último VS separado, guardado no aparelho (IndexedDB): a separação leva minutos, então se a
 * página fechar (ou o usuário sair e voltar) as pistas continuam lá. Nada vai para o servidor.
 */
import type { Beats } from "./tempo";

const DB = "mixpro-vs";
const STORE = "vs";
const KEY = "last";
const MAX_AGE_MS = 7 * 24 * 3600_000;

export type SavedVS = {
  name: string;
  /** Identifica o arquivo (cobrança e "já separado"). */
  key: string;
  savedAt: number;
  sampleRate: number;
  beats: Beats;
  /** Separado no servidor (créditos já cobrados): baixar as pistas não cobra de novo. */
  paid?: boolean;
  /** [instrumento][canal] em 16 bits; o clique é gerado de novo a partir das batidas. */
  stems: Int16Array[][];
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveVS(v: SavedVS): Promise<Error | null> {
  try {
    await run("readwrite", (s) => s.put(v, KEY));
    await run("readwrite", (s) => s.put({ name: v.name, savedAt: v.savedAt }, "meta"));
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

export async function loadVS(): Promise<SavedVS | null> {
  try {
    const v = await run<SavedVS | undefined>("readonly", (s) => s.get(KEY));
    return v && Date.now() - v.savedAt < MAX_AGE_MS ? v : null;
  } catch {
    return null;
  }
}

/** Só o nome e a data (sem carregar as pistas na memória). */
export async function peekVS(): Promise<{ name: string; savedAt: number } | null> {
  try {
    const m = await run<{ name: string; savedAt: number } | undefined>("readonly", (s) => s.get("meta"));
    return m && Date.now() - m.savedAt < MAX_AGE_MS ? m : null;
  } catch {
    return null;
  }
}

export async function clearVS(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
    await run("readwrite", (s) => s.delete("meta"));
  } catch {}
}
