/**
 * Recibo por e-mail quando um pedido premium é pago. Só envia se RESEND_API_KEY e RESEND_FROM estiverem configurados
 * (senão, pula sem erro: o Mercado Pago continua mandando o comprovante dele). Uma vez por pedido (claim no banco).
 */
import { SUPPORT_WHATSAPP_PRETTY, supportUrl } from "@/lib/support";

export type ReceiptInput = { product: string; priceBrl: number; listPriceBrl: number; intro: boolean; method: "brl" | "credits"; credits: number; projectUrl: string | null; orderId: string };

const NAME: Record<string, string> = {
  vs_premium: "VS Premium 7 faixas",
  mix_ia: "Mix & Master IA",
  producao: "Produção da composição",
  voz_final: "Voz finalizada",
  pacote_compositor: "Pacote compositor",
  eng_finaliza: "Engenheiro finaliza",
};
const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function buildReceipt(r: ReceiptInput, appUrl: string): { subject: string; text: string; html: string } {
  const name = NAME[r.product] ?? "Produção";
  const paid = r.method === "credits" ? `${r.credits} créditos` : brl(r.priceBrl);
  const link = r.projectUrl ? `${appUrl.replace(/\/$/, "")}${r.projectUrl}` : null;
  const wa = supportUrl(`Olá! Tenho uma dúvida sobre o meu pedido ${r.orderId.slice(0, 8)} (${name}).`);
  const lines = [
    "Recebemos o seu pagamento. Obrigado!",
    "",
    `Pedido: ${name}`,
    `Valor: ${paid}${r.intro ? " (preço da 1ª experiência)" : ""}`,
    `Número: ${r.orderId.slice(0, 8)}`,
    link ? `Acompanhe e baixe: ${link}` : "",
    "",
    `Se algo não ficar como você esperava, chame no WhatsApp ${SUPPORT_WHATSAPP_PRETTY}: refazemos.`,
  ];
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111">
<h2 style="margin:0 0 8px">Pagamento recebido ✅</h2>
<p>Obrigado! Seu pedido do <strong>Mix Pro</strong> já está em andamento.</p>
<table style="border-collapse:collapse;margin:12px 0"><tr><td style="padding:4px 12px 4px 0;color:#555">Pedido</td><td><strong>${esc(name)}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Valor</td><td><strong>${esc(paid)}</strong>${r.intro ? " (preço da 1ª experiência)" : ""}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Número</td><td>${esc(r.orderId.slice(0, 8))}</td></tr></table>
${link ? `<p><a href="${esc(link)}" style="background:#7c3aed;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Acompanhar e baixar</a></p>` : ""}
<p style="color:#555;font-size:13px">Se algo não ficar como você esperava, <a href="${esc(wa)}">chame no WhatsApp ${SUPPORT_WHATSAPP_PRETTY}</a>: refazemos.</p></div>`;
  return { subject: `Pagamento recebido — ${name}`, text: lines.join("\n"), html };
}

/** Envia pela API do Resend. Devolve false se não estiver configurado ou falhar (o chamador libera para tentar de novo). */
export async function sendEmail(
  o: { to: string; subject: string; text: string; html: string },
  fetchFn: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const key = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  if (!key || !from) return false;
  try {
    const r = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [o.to], subject: o.subject, text: o.text, html: o.html }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
