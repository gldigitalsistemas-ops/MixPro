import { Suspense } from "react";
import { ToolsView } from "@/components/tools/tools-view";

export const metadata = { title: "Ferramentas de estúdio" };

export default function ToolsPage() {
  return (
    <Suspense>
      <ToolsView />
    </Suspense>
  );
}
