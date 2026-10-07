/**
 * Catálogo de samples de bateria e caixas (IR): resolve um ID nos arquivos do bucket público
 * drum-samples. O serviço NUNCA usa os caminhos que vêm no job, só os IDs.
 * - RestCatalog: lê as tabelas públicas drum_samples/cab_irs (somente leitura, chave pública).
 * - StaticCatalog: lista fixa (testes e uso sem rede).
 */
export type DrumAsset = { id: string; files: string[]; room_files: string[] };
export type IrAsset = { id: string; file: string };

export interface AssetCatalog {
  drumSample(id: string): Promise<DrumAsset | null>;
  ir(id: string): Promise<IrAsset | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class StaticCatalog implements AssetCatalog {
  constructor(private drums: DrumAsset[] = [], private irs: IrAsset[] = []) {}
  async drumSample(id: string) {
    return this.drums.find((d) => d.id === id) ?? null;
  }
  async ir(id: string) {
    return this.irs.find((d) => d.id === id) ?? null;
  }
}

export class RestCatalog implements AssetCatalog {
  private cache = new Map<string, { at: number; value: unknown }>();

  /** @param url URL pública do projeto Supabase; @param anonKey chave pública (a mesma do app) */
  constructor(private url: string, private anonKey: string, private ttlMs = 5 * 60_000) {}

  private async row<T>(table: string, cols: string, id: string): Promise<T | null> {
    if (!UUID.test(id)) return null;
    const key = `${table}:${id}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value as T | null;
    const res = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/${table}?select=${cols}&active=eq.true&id=eq.${id}`, {
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}` },
    });
    if (!res.ok) throw new Error(`catálogo: HTTP ${res.status}`);
    const rows = (await res.json()) as T[];
    const value = rows[0] ?? null;
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  drumSample(id: string) {
    return this.row<DrumAsset>("drum_samples", "id,files,room_files", id);
  }
  ir(id: string) {
    return this.row<IrAsset>("cab_irs", "id,file", id);
  }
}
