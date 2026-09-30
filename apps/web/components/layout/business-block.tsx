import { getBusiness, whatsappLink } from "@/lib/business";

/** Identificação de quem vende e canais de atendimento (termos e privacidade). */
export async function BusinessBlock() {
  const b = await getBusiness();
  const missing = !b.nome || !b.documento || !b.email;
  const wa = whatsappLink(b.whatsapp);
  return (
    <div className="rounded-xl border border-border p-3 text-text">
      {missing ? (
        <p className="text-amber-200">
          Dados do responsável ainda não cadastrados. (Administrador: preencha em Admin → Configurações → “empresa”: nome ou razão social,
          CPF/CNPJ, endereço, e-mail e WhatsApp.)
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          <li>
            <strong>{b.nome}</strong> — CPF/CNPJ {b.documento}
          </li>
          {b.endereco && <li>{b.endereco}</li>}
          <li>
            Atendimento:{" "}
            <a href={`mailto:${b.email}`} className="text-violet-200 underline">
              {b.email}
            </a>
            {wa && (
              <>
                {" · "}
                <a href={wa} target="_blank" rel="noopener noreferrer" className="text-violet-200 underline">
                  WhatsApp {b.whatsapp}
                </a>
              </>
            )}
          </li>
        </ul>
      )}
    </div>
  );
}
