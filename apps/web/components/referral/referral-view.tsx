"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Gift, MessageCircle, Share2 } from "lucide-react";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";

type Stats = { total_referred: number; qualified: number; credits_earned: number };

export function ReferralView() {
  const { user, account, requireLogin } = useAccountCtx();
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [copied, setCopied] = useState(false);
  const reward = account?.referralReward ?? 10;
  const link = account && typeof window !== "undefined" ? `${window.location.origin}/r/${account.referralCode}` : "";
  const text = `Tô usando o Mix Pro pra deixar meus vídeos com som de estúdio e legenda automática, direto no celular. Entra pelo meu link e ganha +${reward} créditos na primeira compra:`;

  useEffect(() => {
    if (!user) return;
    supabaseBrowser()
      .rpc("my_referral_stats")
      .then(({ data }) => data && setStats(data as Stats));
  }, [user]);

  const share = async () => {
    try {
      await navigator.share({ title: "Mix Pro", text, url: link });
    } catch (e) {
      if ((e as Error).name !== "AbortError") window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`, "_blank", "noopener");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Segure no link para copiar.");
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Indique e ganhe</h1>

      <Card className="relative overflow-hidden p-6">
        <div aria-hidden className="absolute -right-10 -top-10 size-40 rounded-full bg-primary/30 blur-3xl" />
        <Gift className="size-8 text-pink-300" />
        <p className="mt-3 font-display text-2xl font-bold">
          Você e seu amigo ganham <span className="text-gradient">+{reward} créditos</span>
        </p>
        <p className="mt-2 text-sm text-muted">
          Mande seu link para quem grava vídeos. Quando o amigo criar a conta pelo link e fizer a primeira compra de créditos,
          vocês dois ganham +{reward} créditos na hora.
        </p>
      </Card>

      {user && account ? (
        <>
          <Card className="flex flex-col gap-3 p-5">
            <span className="text-sm text-muted">Seu link de convite</span>
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-black/20 p-2 pl-4">
              <span className="min-w-0 flex-1 truncate text-sm">{link}</span>
              <Button variant="secondary" size="sm" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`, "_blank", "noopener")}
              >
                <MessageCircle className="size-4" /> Enviar no WhatsApp
              </Button>
              <Button variant="secondary" onClick={share}>
                <Share2 className="size-4" /> Compartilhar
              </Button>
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-3">
            {[
              ["Amigos que entraram", stats?.total_referred ?? 0],
              ["Já compraram", stats?.qualified ?? 0],
              ["Créditos ganhos", stats?.credits_earned ?? 0],
            ].map(([label, v]) => (
              <Card key={label as string} className="p-4 text-center">
                <p className="font-display text-2xl font-bold tabular-nums">{v}</p>
                <p className="text-xs text-muted">{label}</p>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Button size="lg" onClick={() => void requireLogin("Crie sua conta para ter o seu link de convite.")}>
          Criar conta e pegar meu link
        </Button>
      )}
    </div>
  );
}
