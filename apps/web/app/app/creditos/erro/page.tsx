import { XCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Pagamento não concluído" };

export default function PagamentoErroPage() {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-red-500/15">
        <XCircle className="size-10 text-red-400" />
      </div>
      <div>
        <h1 className="font-display text-2xl font-semibold">Pagamento não concluído</h1>
        <p className="mt-2 max-w-sm text-muted">
          O pagamento foi cancelado ou recusado. Nenhum valor foi cobrado. Tente novamente com outro método de pagamento.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <ButtonLink href="/app/creditos/comprar">Tentar novamente</ButtonLink>
        <ButtonLink href="/app" variant="secondary">Voltar ao início</ButtonLink>
      </div>
    </div>
  );
}
