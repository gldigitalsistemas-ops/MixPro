"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

export const REF_STORAGE_KEY = "mixpro_ref";

export type Account = {
  balance: number;
  monthlyAllowance: number;
  renewsAt: string;
  referralCode: string;
  referralReward: number;
};

export type AccountUser = { id: string; email: string | null; name: string | null };

type ClaimResult = {
  balance: number;
  monthly_allowance: number;
  renews_at: string;
  referral_code: string;
  referral_reward: number;
};

export class NoCreditsError extends Error {
  constructor() {
    super("Seus créditos deste mês acabaram.");
  }
}

export class NeedLoginError extends Error {
  constructor() {
    super("Entre na sua conta para baixar.");
  }
}

/** Garante os créditos do mês (idempotente no banco) e devolve o saldo. */
async function claim(): Promise<Account> {
  const { data, error } = await supabaseBrowser().rpc("claim_monthly_credits");
  if (error) throw error;
  const r = data as ClaimResult;
  return {
    balance: r.balance,
    monthlyAllowance: r.monthly_allowance,
    renewsAt: r.renews_at,
    referralCode: r.referral_code,
    referralReward: r.referral_reward,
  };
}

function toUser(session: Session | null): AccountUser | null {
  if (!session) return null;
  const u = session.user;
  return { id: u.id, email: u.email ?? null, name: (u.user_metadata?.display_name as string | undefined) ?? null };
}

/** Usuário logado, créditos do mês e presets favoritos (salvos na conta). */
export function useAccount() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [acc, fav] = await Promise.allSettled([claim(), sb.from("favorites").select("preset_id")]);
    if (acc.status === "fulfilled") {
      setAccount(acc.value);
      setUnavailable(false);
    } else {
      setUnavailable(true);
    }
    if (fav.status === "fulfilled" && fav.value.data) {
      setFavorites(new Set(fav.value.data.map((r) => r.preset_id as string)));
    }
  }, []);

  useEffect(() => {
    const sb = supabaseBrowser();
    const apply = (session: Session | null) => {
      setUser(toUser(session));
      setReady(true);
      if (session) {
        // fora do callback do Auth: chamadas ao Supabase dentro dele podem travar
        setTimeout(() => void load(), 0);
      } else {
        setAccount(null);
        setFavorites(new Set());
      }
    };
    sb.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") apply(session);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  /** Relê a sessão (ex.: depois de confirmar o e-mail em outra aba). */
  const refresh = useCallback(async () => {
    const { data } = await supabaseBrowser().auth.getSession();
    setUser(toUser(data.session));
    if (data.session) await load();
  }, [load]);

  /** Debita 1 crédito. `ref` identifica o resultado: repetir o mesmo download não cobra de novo. */
  const spend = useCallback(
    async (ref: string, kind: "video" | "audio"): Promise<void> => {
      // lê a sessão na hora: quem chama pode ter acabado de entrar na conta
      const sb = supabaseBrowser();
      if (!(await sb.auth.getSession()).data.session) throw new NeedLoginError();
      // internet do celular oscila: tenta de novo (o mesmo `ref` nunca cobra duas vezes)
      let { data, error } = await sb.rpc("spend_export_credit", { p_ref: ref, p_kind: kind });
      for (const wait of [800, 2000, 4000]) {
        if (!error || !isNetworkError(error)) break;
        await new Promise((r) => setTimeout(r, wait));
        ({ data, error } = await sb.rpc("spend_export_credit", { p_ref: ref, p_kind: kind }));
      }
      if (error) {
        if (isNetworkError(error)) throw new OfflineError();
        if (String(error.message ?? "").includes("INSUFFICIENT_CREDITS")) throw new NoCreditsError();
        // Sem as funções de crédito no servidor, o usuário não é bloqueado.
        if (unavailable) return;
        throw error;
      }
      setAccount((a) => (a ? { ...a, balance: data as number } : a));
    },
    [unavailable],
  );

  const toggleFavorite = useCallback(
    async (presetId: string): Promise<boolean> => {
      if (!user) throw new NeedLoginError();
      const sb = supabaseBrowser();
      const isFav = favorites.has(presetId);
      setFavorites((cur) => {
        const next = new Set(cur);
        if (isFav) next.delete(presetId);
        else next.add(presetId);
        return next;
      });
      const { error } = isFav
        ? await sb.from("favorites").delete().eq("user_id", user.id).eq("preset_id", presetId)
        : await sb.from("favorites").insert({ user_id: user.id, preset_id: presetId });
      if (error) {
        setFavorites((cur) => {
          const next = new Set(cur);
          if (isFav) next.add(presetId);
          else next.delete(presetId);
          return next;
        });
        throw error;
      }
      return !isFav;
    },
    [user, favorites],
  );

  const signOut = useCallback(async () => {
    await supabaseBrowser().auth.signOut();
  }, []);

  return { user, ready, account, unavailable, favorites, spend, toggleFavorite, refresh, signOut };
}

/** Sem internet para registrar o download (o arquivo já gerado fica guardado para tentar de novo). */
export class OfflineError extends Error {
  constructor() {
    super("Sem conexão para registrar o download.");
    this.name = "OfflineError";
  }
}

function isNetworkError(error: { message?: string } | null): boolean {
  return /load failed|failed to fetch|networkerror|network request failed|timed? ?out/i.test(String(error?.message ?? ""));
}
