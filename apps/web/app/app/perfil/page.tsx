import { LogOut } from "lucide-react";
import { requireSession } from "@/lib/supabase/server";
import { getBalance } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const session = await requireSession("/app/perfil");
  const balance = await getBalance();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Meu perfil</h1>
      <Card className="flex flex-col gap-5 p-6">
        <div className="flex items-center gap-4">
          <div className="bg-brand grid size-14 place-items-center rounded-full text-xl font-semibold">
            {(session.profile.display_name ?? session.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{session.profile.display_name}</p>
            <p className="truncate text-sm text-muted">{session.email}</p>
            <div className="mt-1 flex gap-2">
              <Badge tone="primary">{balance} downloads</Badge>
              {session.profile.role === "admin" && <Badge tone="warning">Administrador</Badge>}
            </div>
          </div>
        </div>
        <ProfileForm userId={session.userId} displayName={session.profile.display_name ?? ""} />
      </Card>

      <Card className="p-6 text-sm text-muted">
        <p className="font-medium text-text">Privacidade dos seus áudios</p>
        <p className="mt-1">
          Seus arquivos são privados e acessados apenas por links temporários. Não usamos suas gravações para treinar modelos de IA.
          Resultados de preview são apagados automaticamente após alguns dias e podem ser gerados novamente a qualquer momento.
        </p>
      </Card>

      <form action="/auth/sair" method="post">
        <button className="flex items-center gap-2 text-sm text-red-300 hover:text-red-200">
          <LogOut className="size-4" aria-hidden /> Sair da conta
        </button>
      </form>
    </div>
  );
}
