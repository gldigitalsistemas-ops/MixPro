/**
 * Armazenamento de arquivos do serviço. Fatia 3: pasta local (no lugar do R2). A fatia 5 troca
 * por R2 com a mesma interface. Chaves aleatórias (UUID), nunca o nome do arquivo do usuário.
 */
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

/** in/<uuid> (entrada) e out/<uuid>.<ext> (saída). */
export const STORAGE_KEY = /^(in|out)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.(wav|mp3|m4a))?$/;

export interface Storage {
  /** Abre a leitura do início (pode ser chamada mais de uma vez). Erros chegam no próprio fluxo. */
  read(key: string): Readable;
  /** Tamanho em bytes, ou null se não existe. */
  head(key: string): Promise<{ size: number } | null>;
  /** Grava (substitui) de forma atômica. */
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

export class StorageKeyError extends Error {}

function checked(key: string) {
  if (!STORAGE_KEY.test(key)) throw new StorageKeyError("chave inválida");
  return key;
}

export class LocalStorage implements Storage {
  constructor(private dir: string) {}

  private path(key: string) {
    return join(this.dir, checked(key));
  }

  read(key: string): Readable {
    return createReadStream(this.path(key));
  }

  async head(key: string) {
    try {
      const s = await stat(this.path(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async put(key: string, data: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomUUID()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, p);
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}
