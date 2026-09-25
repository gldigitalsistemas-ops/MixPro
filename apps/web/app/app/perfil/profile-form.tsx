"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function ProfileForm({ userId, displayName }: { userId: string; displayName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(displayName);
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const { error } = await supabaseBrowser().from("profiles").update({ display_name: name.trim().slice(0, 60) }).eq("id", userId);
        setSaving(false);
        if (error) toast.error("Não foi possível salvar.");
        else {
          toast.success("Perfil atualizado.");
          router.refresh();
        }
      }}
    >
      <label className="flex flex-1 flex-col gap-1.5 text-sm">
        Nome
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          className="h-11 rounded-xl border border-border-strong bg-black/20 px-4 outline-none focus:border-violet-400"
        />
      </label>
      <Button type="submit" loading={saving} disabled={!name.trim() || name === displayName}>
        Salvar
      </Button>
    </form>
  );
}
