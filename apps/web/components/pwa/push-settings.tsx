"use client";

import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePushState } from "./engagement";

const TEXT: Record<ReturnType<typeof usePushState>["state"], string> = {
  ativo: "Ativado neste aparelho: um lembrete por dia, no começo da noite.",
  perguntar: "Receba um lembrete por dia para tratar seus áudios.",
  bloqueado: "As notificações estão bloqueadas neste navegador. Libere nas configurações do site para ativar.",
  "precisa-instalar": "No iPhone, os lembretes funcionam com o app instalado: Compartilhar → Adicionar à Tela de Início.",
  indisponivel: "Este navegador não oferece notificações.",
};

/** Lembrete diário na página Conta: ligar e desligar neste aparelho. */
export function PushSettings() {
  const { state, enable, disable } = usePushState();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Bell className="size-5 text-violet-300" /> Lembrete diário
      </h2>
      <p className="text-sm text-muted">{TEXT[state]}</p>
      {state === "perguntar" && (
        <Button size="sm" className="self-start" onClick={() => void enable()}>
          Ativar
        </Button>
      )}
      {state === "ativo" && (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => void disable()}>
          Desativar
        </Button>
      )}
    </Card>
  );
}
