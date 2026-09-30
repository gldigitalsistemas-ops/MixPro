"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { BUCKET, fetchIRs, type CabIR } from "@/lib/drums/library";
import { prepareIR } from "@/lib/drums/prepare-upload";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

const input = "h-10 w-full rounded-lg border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400";
const KINDS = [
  { value: "guitar", label: "Guitarra" },
  { value: "bass", label: "Baixo" },
] as const;

export function IrManager() {
  const toast = useToast();
  const sb = supabaseBrowser();
  const [items, setItems] = useState<CabIR[] | null>(null);
  const [form, setForm] = useState({ kind: "guitar" as CabIR["kind"], name: "", description: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => fetchIRs(true).then(setItems), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Dê um nome (ex.: 4x12 V30 · SM57 na borda).");
    if (!file) return toast.error("Escolha o arquivo da IR.");
    setBusy(true);
    const id = crypto.randomUUID();
    const path = `ir/${form.kind}/${id}.wav`;
    try {
      const blob = await prepareIR(file);
      const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "audio/wav", cacheControl: "31536000", upsert: true });
      if (up.error) throw new Error(up.error.message);
      const { error } = await sb.from("cab_irs").insert({
        id,
        kind: form.kind,
        name: form.name.trim(),
        description: form.description.trim() || null,
        file: path,
        position: (items?.length ?? 0) + 1,
      });
      if (error) {
        await sb.storage.from(BUCKET).remove([path]);
        throw new Error(error.message.includes("cab_irs") ? "A migração 20261001000005 já foi rodada no Supabase?" : error.message);
      }
      toast.success("Caixa adicionada.");
      setForm({ ...form, name: "", description: "" });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no envio.");
    } finally {
      setBusy(false);
    }
  }

  async function update(ir: CabIR, patch: Partial<CabIR>) {
    setItems((list) => list?.map((x) => (x.id === ir.id ? { ...x, ...patch } : x)) ?? null);
    const { error } = await sb.from("cab_irs").update(patch).eq("id", ir.id);
    if (error) {
      toast.error("Não foi possível salvar.");
      void reload();
    }
  }

  async function remove(ir: CabIR) {
    if (!confirm(`Apagar “${ir.name}”? Presets que usam esta caixa voltam para a caixa simulada.`)) return;
    const { error } = await sb.from("cab_irs").delete().eq("id", ir.id);
    if (error) return toast.error("Não foi possível apagar.");
    await sb.storage.from(BUCKET).remove([ir.file]);
    setItems((list) => list?.filter((x) => x.id !== ir.id) ?? null);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Card className="flex h-fit flex-col gap-3 p-5">
        <h2 className="font-medium">Adicionar caixa</h2>
        <form onSubmit={upload} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Instrumento
            <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CabIR["kind"] })}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Nome que o usuário vê
            <input className={input} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: 4x12 V30 · SM57 na borda" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Descrição curta (opcional)
            <input
              className={input}
              value={form.description}
              maxLength={160}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Ex.: Médios na cara, ótimo para rock e metal"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Arquivo da IR (.wav)
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,.wav"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-text file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-text"
            />
          </label>
          <Button type="submit" loading={busy}>
            <Upload className="size-4" /> Enviar
          </Button>
        </form>
      </Card>

      <div className="flex flex-col gap-6">
        {items === null ? (
          <p className="text-sm text-muted">Carregando…</p>
        ) : (
          KINDS.map((k) => {
            const list = items.filter((x) => x.kind === k.value);
            return (
              <section key={k.value} className="flex flex-col gap-2">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted">
                  {k.label} <span className="text-subtle">({list.length})</span>
                </h2>
                {!list.length ? (
                  <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">
                    Nenhuma ainda. Sem IR, o amplificador usa a caixa simulada.
                  </p>
                ) : (
                  <Card className="divide-y divide-border overflow-hidden">
                    {list.map((ir) => (
                      <div key={ir.id} className={cn("flex flex-wrap items-center gap-2 p-4", !ir.active && "opacity-60")}>
                        <div className="min-w-0 flex-1">
                          <input
                            defaultValue={ir.name}
                            maxLength={60}
                            onBlur={(e) => e.target.value.trim() && e.target.value !== ir.name && update(ir, { name: e.target.value.trim() })}
                            aria-label="Nome"
                            className="w-full rounded-lg border border-transparent bg-transparent px-1 font-medium outline-none hover:border-border focus:border-violet-400"
                          />
                          <input
                            defaultValue={ir.description ?? ""}
                            maxLength={160}
                            placeholder="Descrição curta"
                            onBlur={(e) => e.target.value !== (ir.description ?? "") && update(ir, { description: e.target.value.trim() || null })}
                            aria-label="Descrição"
                            className="w-full rounded-lg border border-transparent bg-transparent px-1 text-xs text-muted outline-none hover:border-border focus:border-violet-400"
                          />
                        </div>
                        <Badge tone={ir.active ? "success" : "neutral"}>{ir.active ? "Ativa" : "Oculta"}</Badge>
                        <button onClick={() => update(ir, { active: !ir.active })} className="rounded px-2 py-1 text-xs text-muted hover:bg-white/5 hover:text-text">
                          {ir.active ? "Ocultar" : "Ativar"}
                        </button>
                        <button onClick={() => remove(ir)} aria-label="Apagar" className="rounded p-1.5 text-red-300 hover:bg-danger/10">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </Card>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
