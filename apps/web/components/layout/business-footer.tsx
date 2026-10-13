import Link from "next/link";
import { getBusiness, whatsappLink } from "@/lib/business";
import { SUPPORT_WHATSAPP_PRETTY } from "@/lib/support";

/** Rodapé com os dados de quem vende e o atendimento (servidor). */
export async function BusinessFooter() {
  const b = await getBusiness();
  const wa = whatsappLink(b.whatsapp);
  return (
    <footer className="border-t border-border px-4 py-6 text-center text-xs text-subtle">
      <p>
        Mix Pro · <Link href="/termos" className="hover:text-text">Termos</Link> ·{" "}
        <Link href="/privacidade" className="hover:text-text">Privacidade</Link> · <Link href="/ajuda" className="hover:text-text">Ajuda</Link>
        {b.email && (
          <>
            {" · "}
            <a href={`mailto:${b.email}`} className="hover:text-text">
              Atendimento
            </a>
          </>
        )}
        {wa && (
          <>
            {" · "}
            <a href={wa} target="_blank" rel="noopener noreferrer" className="hover:text-text">
              WhatsApp {SUPPORT_WHATSAPP_PRETTY}
            </a>
          </>
        )}
      </p>
      {(b.nome || b.documento) && (
        <p className="mt-1">
          {[b.nome, b.documento && `CPF/CNPJ ${b.documento}`, b.endereco].filter(Boolean).join(" · ")}
        </p>
      )}
    </footer>
  );
}
