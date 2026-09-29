"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Coins, Gift } from "lucide-react";
import { useAccount } from "@/lib/account";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AuthModal } from "@/components/studio/auth-modal";
import { Modal } from "@/components/ui/modal";
import { ButtonLink } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type AccountCtx = ReturnType<typeof useAccount> & {
  isAdmin: boolean;
  freeCredits: number;
  /** Abre a janela de login/cadastro; resolve true se a pessoa entrou. */
  requireLogin: (reason?: string) => Promise<boolean>;
  showNoCredits: () => void;
};

const Ctx = createContext<AccountCtx | null>(null);

export function useAccountCtx(): AccountCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccountCtx fora do AccountProvider");
  return v;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const acc = useAccount();
  const toast = useToast();
  const [isAdmin, setIsAdmin] = useState(false);
  const [freeCredits, setFreeCredits] = useState(5);
  const [auth, setAuth] = useState<{ reason: string | null } | null>(null);
  const [noCredits, setNoCredits] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    supabaseBrowser()
      .from("system_settings")
      .select("value")
      .eq("key", "free_downloads")
      .maybeSingle()
      .then(({ data }) => data && setFreeCredits(Number(data.value)));
  }, []);

  const userId = acc.user?.id;
  useEffect(() => {
    if (!userId) return;
    supabaseBrowser()
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(data?.role === "admin"));
  }, [userId]);

  const requireLogin = useCallback(
    (reason?: string) => {
      if (acc.user) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        pending.current?.(false);
        pending.current = resolve;
        setAuth({ reason: reason ?? null });
      });
    },
    [acc.user],
  );

  const close = (ok: boolean) => {
    setAuth(null);
    pending.current?.(ok);
    pending.current = null;
  };

  const { refresh } = acc;
  const onDone = useCallback(async () => {
    await refresh();
    close(true);
    toast.success("Pronto! Você está conectado.");
  }, [refresh, toast]);

  const value: AccountCtx = {
    ...acc,
    isAdmin: Boolean(userId) && isAdmin,
    freeCredits,
    requireLogin,
    showNoCredits: () => setNoCredits(true),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <AuthModal
        open={auth !== null}
        onClose={() => close(false)}
        onDone={() => void onDone()}
        freeCredits={freeCredits}
        reason={auth?.reason}
      />
      <Modal open={noCredits} onClose={() => setNoCredits(false)} title="Seus créditos acabaram">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Cada download usa 1 crédito. Ouvir e testar presets continua grátis e ilimitado.
          </p>
          <ButtonLink href="/creditos" size="lg" className="w-full" onClick={() => setNoCredits(false)}>
            <Coins className="size-5" /> Comprar créditos (R$ 1 cada)
          </ButtonLink>
          <Link
            href="/indicar"
            onClick={() => setNoCredits(false)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-violet-400/30 bg-primary/10 p-3 text-sm"
          >
            <Gift className="size-4 text-violet-300" /> Indique amigos e ganhe +10 créditos
          </Link>
        </div>
      </Modal>
    </Ctx.Provider>
  );
}
