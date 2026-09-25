import { CheckCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { getBalance } from "@/lib/queries";

export const metadata = { title: "Pagamento confirmado" };

export default async function PagamentoSucessoPage() {
  const balance = await getBalance();

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-green-500/15">
        <CheckCircle className="size-10 text-green-400" />
      </div>
      <div>
        <h1 className="font-display text-2xl font-semibold">Pagamento confirmado!</h1>
        <p className="mt-2 text-muted">
          Seus créditos foram adicionados.
          Você agora tem <span className="font-semibold text-text">{balance} download{balance !== 1 ? "s" : ""}</span> disponíve{balance !== 1 ? "is" : "l"}.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <ButtonLink href="/app/projetos">Ir para meus projetos</ButtonLink>
        <ButtonLink href="/app/creditos/comprar" variant="secondary">Comprar mais</ButtonLink>
      </div>
    </div>
  );
}
