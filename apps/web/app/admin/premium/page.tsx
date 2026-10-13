import Link from "next/link";
import { parsePremium } from "@mixpro/contracts";
import { requireAdmin, supabaseAdmin } from "@/lib/supabase/server";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/cn";
import { PremiumPricesEditor } from "@/components/premium/admin-prices";
import { OrderActions } from "@/components/premium/admin-order-actions";
import { buildFunnel } from "@/lib/premium/funnel";

export const metadata = { title: "Produção" };

const NAME: Record<string, string> = {
  vs_premium: "VS Premium",
  mix_ia: "Mix & Master IA",
  producao: "Produção",
  voz_final: "Voz finalizada",
  pacote_compositor: "Pacote compositor",
  eng_finaliza: "Engenheiro finaliza",
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending_payment: { label: "Aguardando", tone: "warning" },
  paid: { label: "Pago", tone: "success" },
  cancelled: { label: "Cancelado", tone: "neutral" },
  refunded: { label: "Estornado", tone: "danger" },
};
const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Dólar para o painel de margem (ajuste em USD_BRL na Vercel). */
const USD_BRL = Number(process.env.USD_BRL ?? 5.4) || 5.4;
const requestTime = () => Date.now();

export default async function AdminPremium() {
  await requireAdmin();
  const admin = supabaseAdmin();
  const [{ data: orders }, { data: settings }, { data: authList }, { data: jobs }, { count: intros }, { data: projects }, { data: allOrders }] = await Promise.all([
    admin.from("premium_orders").select("id,user_id,project_id,product,price_brl,list_price_brl,intro,pro_discount,method,credits,status,cost_usd,created_at,paid_at").order("created_at", { ascending: false }).limit(300),
    admin.from("system_settings").select("key,value").in("key", ["premium_products", "showcase_reward_credits", "premium_preview_per_day"]),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("tool_jobs").select("tool,params,cpu_ms,wall_ms,status,created_at").not("project_id", "is", null).gte("created_at", new Date(requestTime() - 30 * 86_400_000).toISOString()).limit(2000),
    admin.from("intro_claims").select("id", { count: "exact", head: true }).eq("status", "used"),
    admin.from("premium_projects").select("product,status,order_id").gte("created_at", new Date(requestTime() - 90 * 86_400_000).toISOString()).limit(3000),
    admin.from("premium_orders").select("id,status,intro").gte("created_at", new Date(requestTime() - 90 * 86_400_000).toISOString()).limit(3000),
  ]);
  // funil dos últimos 90 dias: projeto criado → prévia pronta → pago → entregue
  const orderOf = new Map((allOrders ?? []).map((o) => [o.id as string, o as { status: string; intro: boolean }]));
  const funnel = buildFunnel(
    (projects ?? []).map((p) => {
      const o = p.order_id ? orderOf.get(p.order_id as string) : undefined;
      const paid = o?.status === "paid" || o?.status === "refunded";
      return {
        product: p.product as string,
        previewDone: paid || !["draft", "uploaded", "preview", "failed"].includes(p.status as string),
        paid,
        delivered: p.status === "delivered",
        intro: Boolean(o?.intro),
        refunded: o?.status === "refunded",
      };
    }),
  );
  const get = (k: string) => settings?.find((s) => s.key === k)?.value;
  const catalog = parsePremium(get("premium_products"));
  const emails = new Map((authList?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const paid = (orders ?? []).filter((o) => o.status === "paid");
  const since = requestTime() - 30 * 86_400_000;
  const month = paid.filter((o) => new Date((o.paid_at ?? o.created_at) as string).getTime() >= since);
  const revenue = month.filter((o) => o.method === "brl").reduce((n, o) => n + Number(o.price_brl), 0);
  const credits = month.filter((o) => o.method === "credits").reduce((n, o) => n + Number(o.credits), 0);
  const apiCost = month.reduce((n, o) => n + Number(o.cost_usd), 0) * USD_BRL;
  const previews = (jobs ?? []).filter((j) => (j.params as { preview?: boolean })?.preview).length;
  const cpuH = (jobs ?? []).reduce((n, j) => n + Number(j.cpu_ms ?? 0), 0) / 3_600_000;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Produção (módulos premium)</h1>
        <p className="text-sm text-muted">Pedidos, receita, custo real (API externa + GPU) e margem dos últimos 30 dias. Preços e ofertas logo abaixo.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[
          ["Receita (30 dias)", brl(revenue)],
          ["Pagos em créditos", `${credits} créditos`],
          ["Custo de API/GPU", brl(apiCost)],
          ["Margem (sem créditos)", revenue ? `${Math.round(((revenue - apiCost) / revenue) * 100)}%` : "—"],
          ["Prévias grátis (30 dias)", previews],
          ["1ª experiência usadas", intros ?? 0],
        ].map(([l, v]) => (
          <Card key={l as string} className="p-4">
            <p className="text-xs text-muted">{l}</p>
            <p className="mt-1 font-display text-xl font-semibold tabular-nums">{v}</p>
          </Card>
        ))}
      </div>
      <p className="text-xs text-subtle">CPU do servidor nos jobs premium (30 dias): {cpuH.toFixed(2)} h de processador. Dólar usado: R$ {USD_BRL.toFixed(2)}.</p>

      <Card className="overflow-x-auto">
        <div className="px-4 pt-4">
          <h2 className="font-display text-lg font-semibold">Funil (últimos 90 dias)</h2>
          <p className="text-xs text-muted">Quantos projetos chegam à prévia, ao pagamento e à entrega. Se pouca gente paga depois da prévia, revise o preço ou a qualidade da prévia.</p>
        </div>
        <table className="mt-2 w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-normal">Produto</th>
              <th className="px-4 py-2 font-normal">Criados</th>
              <th className="px-4 py-2 font-normal">Com prévia</th>
              <th className="px-4 py-2 font-normal">Pagos</th>
              <th className="px-4 py-2 font-normal">Conversão prévia→pago</th>
              <th className="px-4 py-2 font-normal">Entregues</th>
              <th className="px-4 py-2 font-normal">1ª experiência</th>
              <th className="px-4 py-2 font-normal">Estornos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {funnel.map((f) => (
              <tr key={f.product}>
                <td className="px-4 py-2 font-medium">{NAME[f.product] ?? f.product}</td>
                <td className="px-4 py-2 tabular-nums">{f.created}</td>
                <td className="px-4 py-2 tabular-nums">{f.previews} <span className="text-xs text-muted">({f.previewRate}%)</span></td>
                <td className="px-4 py-2 tabular-nums">{f.paid}</td>
                <td className="px-4 py-2 tabular-nums">{f.payRate}%</td>
                <td className="px-4 py-2 tabular-nums">{f.delivered}</td>
                <td className="px-4 py-2 tabular-nums">{f.intro}</td>
                <td className="px-4 py-2 tabular-nums">{f.refunded}</td>
              </tr>
            ))}
            {!funnel.length && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-muted">
                  Ainda não há projetos de Produção.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <PremiumPricesEditor catalog={catalog} reward={Number(get("showcase_reward_credits") ?? 10)} previews={Number(get("premium_preview_per_day") ?? 6)} />

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[940px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-normal">Data</th>
              <th className="px-4 py-3 font-normal">Cliente</th>
              <th className="px-4 py-3 font-normal">Produto</th>
              <th className="px-4 py-3 font-normal">Valor</th>
              <th className="px-4 py-3 font-normal">Custo</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3 font-normal">Projeto</th>
              <th className="px-4 py-3 font-normal">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(orders ?? []).map((o) => {
              const s = STATUS[o.status as string] ?? { label: o.status as string, tone: "neutral" as Tone };
              return (
                <tr key={o.id as string}>
                  <td className="px-4 py-3 text-xs text-muted">{formatDateTime(o.created_at as string)}</td>
                  <td className="px-4 py-3 text-xs">{emails.get(o.user_id as string)}</td>
                  <td className="px-4 py-3">
                    {NAME[o.product as string] ?? o.product}
                    {o.intro && <Badge tone="success" className="ml-2">1ª experiência</Badge>}
                    {o.pro_discount && <Badge tone="warning" className="ml-2">Pro</Badge>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{o.method === "credits" ? `${o.credits} créditos` : brl(o.price_brl as number)}</td>
                  <td className="px-4 py-3 tabular-nums text-xs">{brl(Number(o.cost_usd) * USD_BRL)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">{o.project_id ? <Link href={`/premium/${o.project_id}`} className="text-violet-300 underline">abrir</Link> : "—"}</td>
                  <td className="px-4 py-3">
                    <OrderActions orderId={o.id as string} projectId={(o.project_id as string | null) ?? null} product={o.product as string} status={o.status as string} />
                  </td>
                </tr>
              );
            })}
            {!orders?.length && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">
                  Nenhum pedido ainda. Os módulos estão em “Em desenvolvimento” e abertos a todos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-subtle">
        Catálogo atual: {catalog.items.map((i) => `${i.name} ${i.intro_brl !== null ? `${brl(i.intro_brl)} → ` : ""}${brl(i.price_brl)}`).join(" · ")}
      </p>
    </div>
  );
}
