import { NewPasswordForm } from "@/components/auth/auth-form";
import { requireSession } from "@/lib/supabase/server";

export const metadata = { title: "Nova senha" };

export default async function Page() {
  await requireSession("/nova-senha");
  return <NewPasswordForm />;
}
