import { Clock } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Pagamento pendente" };

export default function PagamentoPendentePage() {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-yellow-500/15">
        <Clock className="size-10 text-yellow-400" />
      </div>
      <div>
        <h1 className="font-display text-2xl font-semibold">Pagamento pendente</h1>
        <p className="mt-2 max-w-sm text-muted">
          Para PIX, o código expira em <strong className="text-text">30 minutos</strong>. Seus créditos serão adicionados
          automaticamente assim que o pagamento for confirmado pelo banco.
        </p>
      </div>
      <ButtonLink href="/app/downloads" variant="secondary">
        Ver meu saldo
      </ButtonLink>
    </div>
  );
}
