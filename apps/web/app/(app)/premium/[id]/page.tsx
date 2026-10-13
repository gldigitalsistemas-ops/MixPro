import { Suspense } from "react";
import { ProjectView } from "@/components/premium/project-view";

export const metadata = { title: "Seu projeto" };

export default async function PremiumProjectPage(props: PageProps<"/premium/[id]">) {
  const { id } = await props.params;
  return (
    <Suspense>
      <ProjectView id={id} />
    </Suspense>
  );
}
