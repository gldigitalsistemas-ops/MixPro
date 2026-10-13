"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PARTNER_AUTHORIZATION, PARTNER_FIRST_CONTACT, PARTNER_FOLLOW_UP } from "@/lib/premium/partner-terms";

const ITEMS = [
  { id: "contato", title: "1. Mensagem de primeiro contato", hint: "Para mandar no WhatsApp ou e-mail. Troque o que está entre [colchetes].", text: PARTNER_FIRST_CONTACT },
  { id: "termo", title: "2. Termo de autorização", hint: "Rascunho: peça a um advogado para revisar. O parceiro responde “De acordo” por e-mail; guarde a resposta e anote no formulário de envio quem autorizou.", text: PARTNER_AUTHORIZATION },
  { id: "lembrete", title: "3. Lembrete (se não responder)", hint: "Três dias depois do envio do termo.", text: PARTNER_FOLLOW_UP },
];

/** Kit para trazer parceiros: textos prontos com botão de copiar. */
export function PartnerKit() {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">Kit para trazer parceiros</h2>
        <p className="text-sm text-muted">Textos prontos para pedir autorização por escrito. Só envie músicas ao treino depois da resposta do parceiro.</p>
      </div>
      {ITEMS.map((it) => (
        <details key={it.id} className="rounded-2xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-semibold">{it.title}</summary>
          <p className="mt-2 text-xs text-muted">{it.hint}</p>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-black/20 p-3 text-xs">{it.text}</pre>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              void navigator.clipboard?.writeText(it.text).then(() => {
                setCopied(it.id);
                setTimeout(() => setCopied(null), 2000);
              });
            }}
          >
            {copied === it.id ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied === it.id ? "Copiado" : "Copiar texto"}
          </Button>
        </details>
      ))}
    </Card>
  );
}
