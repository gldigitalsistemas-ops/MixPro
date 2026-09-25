import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-form";

export const metadata = { title: "Entrar" };

export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
