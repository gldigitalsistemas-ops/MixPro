/**
 * Trava da "1ª experiência" (preço de lançamento uma vez por pessoa). Nada é guardado em claro: o banco
 * recebe só hashes HMAC (com segredo do servidor) de:
 *   - aparelho: identificador aleatório que o app guarda no navegador (localStorage + cookie + IndexedDB);
 *   - CPF: exigido só para a oferta (validado pelos dígitos verificadores);
 *   - rede + aparelho: prefixo do IP (/24 ou /48) somado à "assinatura" do navegador — pega a mesma
 *     pessoa em aba anônima ou com o armazenamento limpo, sem bloquear quem só divide o Wi-Fi.
 * Além disso: e-mail confirmado e domínio de e-mail descartável recusado.
 */
import { createHash, createHmac } from "node:crypto";

export function hmac(secret: string, kind: string, value: string): string {
  return createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
}

/** CPF válido (só dígitos, com dígitos verificadores corretos e não repetido). */
export function validCpf(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const dv = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]) ? d : null;
}

/** Identificador do aparelho gerado pelo app: 32 caracteres hexadecimais. */
export function validDeviceId(v: unknown): string | null {
  return typeof v === "string" && /^[a-f0-9]{32}$/.test(v) ? v : null;
}

/** Prefixo de rede: /24 no IPv4, /48 no IPv6 (o resto do endereço muda à toa no celular). */
export function netPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const v = ip.trim().replace(/^::ffff:/, "");
  const v4 = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}`;
  if (v.includes(":")) {
    const parts = v.split(":").filter((p, i, a) => p !== "" || (i > 0 && i < a.length - 1));
    return parts.slice(0, 3).join(":").toLowerCase() || null;
  }
  return null;
}

/** IP do cliente atrás da Vercel. */
export function clientIp(headers: Headers): string | null {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** "Assinatura" do navegador: dados técnicos estáveis que o app envia (sem nada pessoal). */
export function validFingerprint(v: unknown): string | null {
  return typeof v === "string" && /^[a-f0-9]{16,64}$/.test(v) ? v : null;
}

const DISPOSABLE = new Set([
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com",
  "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com",
  "emailondeck.com", "mohmal.com", "tempail.com", "burnermail.io", "moakt.com", "mailnesia.com", "spamgourmet.com", "tmail.ws",
  "tempr.email", "discard.email", "mytemp.email", "inboxkitten.com", "luxusmail.org", "1secmail.com", "emailfake.com",
]);

export function disposableEmail(email: string | null): boolean {
  const domain = email?.split("@")[1]?.toLowerCase().trim() ?? "";
  return Boolean(domain) && (DISPOSABLE.has(domain) || [...DISPOSABLE].some((d) => domain.endsWith(`.${d}`)));
}

export type IntroIdentity = { deviceHash: string; cpfHash: string; netHash: string | null };

/**
 * Monta a identidade para a oferta. Devolve o motivo quando falta algo (a tela explica o que fazer).
 */
export function introIdentity(
  secret: string,
  o: { deviceId: unknown; cpf: unknown; fingerprint: unknown; ip: string | null; email: string | null; emailConfirmed: boolean },
): { ok: true; id: IntroIdentity } | { ok: false; reason: "EMAIL_UNCONFIRMED" | "EMAIL_DISPOSABLE" | "CPF_INVALID" | "DEVICE_MISSING" } {
  if (!o.emailConfirmed) return { ok: false, reason: "EMAIL_UNCONFIRMED" };
  if (disposableEmail(o.email)) return { ok: false, reason: "EMAIL_DISPOSABLE" };
  const device = validDeviceId(o.deviceId);
  if (!device) return { ok: false, reason: "DEVICE_MISSING" };
  const cpf = typeof o.cpf === "string" ? validCpf(o.cpf) : null;
  if (!cpf) return { ok: false, reason: "CPF_INVALID" };
  const fp = validFingerprint(o.fingerprint);
  const net = netPrefix(o.ip);
  return {
    ok: true,
    id: { deviceHash: hmac(secret, "device", device), cpfHash: hmac(secret, "cpf", cpf), netHash: net && fp ? hmac(secret, "net", `${net}|${fp}`) : null },
  };
}

export const INTRO_REASON_MESSAGE: Record<string, string> = {
  EMAIL_UNCONFIRMED: "Confirme o seu e-mail (enviamos um link no cadastro) para usar o preço da primeira experiência.",
  EMAIL_DISPOSABLE: "O preço da primeira experiência não vale para e-mails temporários. Use o seu e-mail pessoal.",
  CPF_INVALID: "Informe um CPF válido. Ele é usado só para garantir uma primeira experiência por pessoa e não fica guardado.",
  DEVICE_MISSING: "Não conseguimos identificar este aparelho. Recarregue a página e tente de novo.",
  INTRO_USED: "A primeira experiência deste recurso já foi usada por esta pessoa ou neste aparelho. O preço normal continua disponível.",
};

/** UUID estável a partir do link de antes e depois (um item de vitrine por link; repetir o pedido devolve o mesmo). */
export function idFromToken(token: string): string {
  const h = createHash("sha256").update(`showcase:${token}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
