import { Suspense } from "react";
import { CreditsView } from "@/components/credits/credits-view";

export const metadata = { title: "Créditos" };

export default function CreditsPage() {
  return (
    <Suspense>
      <CreditsView />
    </Suspense>
  );
}
