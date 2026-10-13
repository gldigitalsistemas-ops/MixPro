/**
 * Funil da Produção: de quantos projetos criados chegam à prévia, ao pagamento e à entrega, por produto.
 * Função pura (testável); o Admin só busca as linhas.
 */
export type FunnelProject = { product: string; previewDone: boolean; paid: boolean; delivered: boolean; intro: boolean; refunded: boolean };
export type FunnelRow = { product: string; created: number; previews: number; paid: number; delivered: number; intro: number; refunded: number; previewRate: number; payRate: number };

export function buildFunnel(list: FunnelProject[]): FunnelRow[] {
  const by = new Map<string, FunnelRow>();
  for (const p of list) {
    const r = by.get(p.product) ?? { product: p.product, created: 0, previews: 0, paid: 0, delivered: 0, intro: 0, refunded: 0, previewRate: 0, payRate: 0 };
    r.created++;
    if (p.previewDone) r.previews++;
    if (p.paid) r.paid++;
    if (p.delivered) r.delivered++;
    if (p.paid && p.intro) r.intro++;
    if (p.refunded) r.refunded++;
    by.set(p.product, r);
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return [...by.values()]
    .map((r) => ({ ...r, previewRate: pct(r.previews, r.created), payRate: pct(r.paid, r.previews) }))
    .sort((a, b) => b.created - a.created);
}
