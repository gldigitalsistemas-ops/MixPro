/**
 * Atendimento: um único lugar com o WhatsApp de suporte, usado no app inteiro (telas, erros, módulos de Produção,
 * rodapé, termos). O número do Admin → Configurações → empresa vale quando preenchido; este é o padrão para nunca faltar.
 */
export const SUPPORT_WHATSAPP = "5521972652314";
export const SUPPORT_WHATSAPP_PRETTY = "(21) 97265-2314";

/** Link do WhatsApp com a mensagem já escrita (ajuda o atendimento a saber de onde veio). */
export function supportUrl(message?: string, number: string = SUPPORT_WHATSAPP): string {
  const digits = number.replace(/\D/g, "");
  const n = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${n}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}
