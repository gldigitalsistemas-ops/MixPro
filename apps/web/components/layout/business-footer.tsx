import Link from "next/link";
import { getBusiness, whatsappLink } from "@/lib/business";

/** Rodapé com os dados de quem vende e o atendimento (servidor). */
export async function BusinessFooter() {
  const b = await getBusiness();
  const wa = whatsappLink(b.whatsapp);
  return (
    <footer className="border-t border-border px-4 py-6 text-center text-xs text-subtle">
      <p>
        Mix Pro · <Link href="/termos" className="hover:text-text">Termos</Link> ·{" "}
        <Link href="/privacidade" className="hover:text-text">Privacidade</Link>
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
              WhatsApp
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
