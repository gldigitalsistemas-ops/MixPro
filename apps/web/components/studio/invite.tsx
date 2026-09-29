"use client";

import { useState } from "react";
import { Check, Copy, Gift, Share2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Account } from "@/lib/account";
import { formatDate } from "@/lib/cn";

export function inviteLink(code: string) {
  return `${window.location.origin}/r/${code}`;
}

function inviteText(reward: number) {
  return `Tô usando o Mix Pro pra deixar o som dos meus vídeos com qualidade de estúdio, grátis e direto no celular. Entra pelo meu link e ganha +${reward} créditos:`;
}

export function CreditsPill({ account, onClick }: { account: Account | null; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 items-center gap-2 rounded-full border border-border-strong px-3.5 text-sm transition hover:bg-white/5"
    >
      <Gift className="size-4 text-violet-300" aria-hidden />
      {account ? (
        <span>
          <strong className="tabular-nums">{account.balance}</strong> <span className="text-muted">créditos</span>
        </span>
      ) : (
        <span>Ganhe créditos</span>
      )}
    </button>
  );
}

export function InviteModal({
  open,
  onClose,
  account,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  account: Account | null;
  reason?: "no-credits" | null;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const reward = account?.referralReward ?? 10;
  const link = account ? inviteLink(account.referralCode) : "";

  const share = async () => {
    const text = inviteText(reward);
    if (navigator.share) {
      try {
        await navigator.share({ title: "Mix Pro", text, url: link });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`, "_blank", "noopener");
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
    <Modal open={open} onClose={onClose} title={reason === "no-credits" ? "Seus créditos acabaram" : "Créditos grátis"}>
      <div className="flex flex-col gap-5">
        {account ? (
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-2xl bg-white/5 p-3">
              <p className="font-display text-2xl font-bold tabular-nums">{account.balance}</p>
              <p className="text-xs text-muted">créditos agora</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-3">
              <p className="font-display text-2xl font-bold tabular-nums">{account.monthlyAllowance}</p>
              <p className="text-xs text-muted">grátis todo mês · renova {formatDate(account.renewsAt)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Entre na sua conta para ver seus créditos e seu link de convite.</p>
        )}

        <div className="rounded-2xl border border-violet-400/30 bg-primary/10 p-4">
          <p className="font-display text-lg font-semibold">
            Indique e ganhe <span className="text-gradient">+{reward} créditos</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            Mande seu link para amigos que gravam vídeos. Quando o amigo baixar o primeiro vídeo ou áudio,{" "}
            <strong className="text-text">vocês dois ganham +{reward}</strong>. Vale para até 30 amigos por mês.
          </p>
        </div>

        {account && (
          <>
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-black/20 p-2 pl-4">
              <span className="min-w-0 flex-1 truncate text-sm">{link}</span>
              <Button variant="secondary" size="sm" onClick={copy} aria-label="Copiar link">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <Button size="lg" onClick={share} className="w-full">
              <Share2 className="size-5" /> Compartilhar convite
            </Button>
          </>
        )}
        <p className="text-center text-xs text-subtle">1 crédito = 1 download. Ouvir e testar presets é sempre grátis e ilimitado.</p>
      </div>
    </Modal>
  );
}
