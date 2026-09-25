import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { OrderForm } from "./order-form";

export const metadata = { title: "Novo pedido de mixagem" };

export default async function NovoPedidoPage(props: PageProps<"/app/mixagem-profissional/pedido">) {
  const sp = await props.searchParams;
  const serviceId = typeof sp?.service === "string" ? sp.service : null;

  const { data: services } = await supabaseAdmin()
    .from("pro_services")
    .select("id,name,price_brl,max_stems,delivery_days,max_revisions")
    .eq("active", true)
    .order("position");

  if (!services?.length) notFound();
  const service = serviceId ? (services.find((s) => s.id === serviceId) ?? services[0]) : services[0];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Novo pedido de mixagem</h1>
        <p className="mt-1 text-sm text-muted">
          Envie os stems do seu projeto e receba o mix profissional em até{" "}
          <strong className="text-text">{service.delivery_days} dias úteis</strong>.
        </p>
      </div>
      <OrderForm service={service} defaultServiceId={serviceId ?? undefined} />
    </div>
  );
}
