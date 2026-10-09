"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Coins, Gift, LogOut, Mic2, Palette, Shield, Star, Trash2 } from "lucide-react";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PushSettings } from "@/components/pwa/push-settings";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { deleteStyle, listStyles, type SavedStyle } from "@/lib/styles";

export function AccountView() {
  const { user, isAdmin, favorites, signOut, requireLogin } = useAccountCtx();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [favNames, setFavNames] = useState<string[]>([]);
  const [styles, setStyles] = useState<SavedStyle[]>([]);

  useEffect(() => {
    if (!user) return;
    const sb = supabaseBrowser();
    sb.from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setName((data?.display_name as string) ?? ""));
    listStyles().then(setStyles).catch(() => {});
  }, [user]);

  useEffect(() => {
    const ids = [...favorites];
    if (!ids.length) return;
    supabaseBrowser()
      .from("presets")
      .select("name")
      .in("id", ids)
      .then(({ data }) => setFavNames((data ?? []).map((r) => r.name as string)));
  }, [favorites]);

  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
        <h1 className="font-display text-2xl font-semibold">Sua conta</h1>
        <p className="text-sm text-muted">Entre para ver seus créditos, favoritos, estilos salvos e pedidos.</p>
        <Button size="lg" onClick={() => void requireLogin()}>
          Entrar ou criar conta
        </Button>
      </div>
    );
  }

  async function saveName() {
    setSaving(true);
    const { error } = await supabaseBrowser().from("profiles").update({ display_name: name.trim().slice(0, 60) }).eq("id", user!.id);
    setSaving(false);
    if (error) toast.error("Não foi possível salvar.");
    else toast.success("Nome atualizado.");
  }

  const links = [
    { href: "/creditos", icon: Coins, label: "Créditos e compras" },
    { href: "/mixagem-profissional", icon: Mic2, label: "Meus pedidos de mixagem profissional" },
    { href: "/indicar", icon: Gift, label: "Indicar amigos" },
    ...(isAdmin ? [{ href: "/admin", icon: Shield, label: "Painel administrativo" }] : []),
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Sua conta</h1>

      <Card className="flex flex-col gap-3 p-5">
        <p className="text-sm text-muted">{user.email}</p>
        <label className="flex flex-col gap-1.5 text-sm">
          Nome
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="h-11 min-w-0 flex-1 rounded-xl border border-border-strong bg-black/20 px-3 outline-none focus:border-violet-400"
            />
            <Button variant="secondary" onClick={saveName} loading={saving}>
              Salvar
            </Button>
          </div>
        </label>
      </Card>

      <PushSettings />

      <Card className="p-2">
        {links.map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm hover:bg-white/5">
            <Icon className="size-5 text-violet-300" /> <span className="flex-1">{label}</span>
            <ChevronRight className="size-4 text-subtle" />
          </Link>
        ))}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
          <Palette className="size-5 text-violet-300" /> Meus estilos
        </h2>
        {styles.length ? (
          <ul className="flex flex-col gap-2">
            {styles.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                <span className="flex-1">{s.name}</span>
                <button
                  aria-label={`Apagar estilo ${s.name}`}
                  className="rounded-full p-2 text-subtle hover:bg-white/5 hover:text-red-300"
                  onClick={async () => {
                    await deleteStyle(s.id);
                    setStyles((cur) => cur.filter((x) => x.id !== s.id));
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            No estúdio, depois de ajustar som, legendas e formato, toque em “Salvar meu estilo” para aplicar tudo com um toque
            nos próximos vídeos.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
          <Star className="size-5 text-amber-300" /> Presets favoritos
        </h2>
        {favNames.length ? (
          <ul className="flex flex-wrap gap-2">
            {favNames.map((n) => (
              <li key={n} className="rounded-full border border-border px-3 py-1 text-sm">
                {n}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Toque na estrela de um preset no estúdio para guardá-lo aqui.</p>
        )}
      </Card>

      <Button
        variant="ghost"
        onClick={async () => {
          await signOut();
          router.push("/");
        }}
      >
        <LogOut className="size-4" /> Sair da conta
      </Button>

      <details className="rounded-2xl border border-border p-4 text-sm">
        <summary className="cursor-pointer text-muted">Excluir minha conta</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted">
            Cancela o plano mensal (se houver), apaga seu nome, presets, estilos e favoritos e desativa o login. Créditos que ainda estiverem na
            conta são perdidos. Os registros de pagamento são mantidos pelo prazo legal, sem seus dados pessoais. Não dá para desfazer.
          </p>
          <DeleteAccount
            onDone={async () => {
              await signOut();
              router.push("/");
            }}
          />
        </div>
      </details>
    </div>
  );
}

function DeleteAccount({ onDone }: { onDone: () => Promise<void> }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await fetch("/api/account/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: text.trim() }),
        }).catch(() => null);
        setBusy(false);
        if (!res?.ok) {
          const msg = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
          return toast.error(msg ?? "Não foi possível excluir agora. Tente de novo.");
        }
        toast.success("Sua conta foi excluída.");
        await onDone();
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Digite EXCLUIR"
        aria-label="Digite EXCLUIR para confirmar"
        className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-red-400"
      />
      <Button type="submit" variant="danger" loading={busy} disabled={text.trim() !== "EXCLUIR"}>
        <Trash2 className="size-4" /> Excluir conta
      </Button>
    </form>
  );
}
