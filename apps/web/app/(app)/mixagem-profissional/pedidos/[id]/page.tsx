import { Suspense } from "react";
import { OrderView } from "@/components/pro/order-view";

export const metadata = { title: "Pedido de mixagem" };

export default async function OrderPage(props: PageProps<"/mixagem-profissional/pedidos/[id]">) {
  const { id } = await props.params;
  return (
    <Suspense>
      <OrderView id={id} />
    </Suspense>
  );
}
