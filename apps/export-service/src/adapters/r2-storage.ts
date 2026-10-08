/**
 * Armazenamento no Cloudflare R2 (fatia 5): a mesma interface da pasta local da fatia 3.
 * As chaves seguem o mesmo padrão (in/<uuid>, out/<uuid>.<ext>) e são validadas antes de qualquer chamada.
 */
import type { Readable } from "node:stream";
import { R2Client, r2ConfigFromEnv, type R2Config } from "@/lib/export/r2";
import { STORAGE_KEY, StorageKeyError, type Storage } from "./storage";

function checked(key: string) {
  if (!STORAGE_KEY.test(key)) throw new StorageKeyError("chave inválida");
  return key;
}

export class R2Storage implements Storage {
  private client: R2Client;
  constructor(cfg: R2Config = r2ConfigFromEnv()) {
    this.client = new R2Client(cfg);
  }

  read(key: string): Readable {
    return this.client.read(checked(key));
  }

  head(key: string) {
    return this.client.head(checked(key));
  }

  put(key: string, data: Uint8Array) {
    return this.client.put(checked(key), data);
  }

  delete(key: string) {
    return this.client.delete(checked(key));
  }
}
