"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Star, Trash2, X } from "lucide-react";
import { BeforeAfterPlayer } from "@/app/ouvir/[token]/player";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { put } from "@/lib/export/server-client";
import { GENRE_LABEL, PRODUCT_LABEL } from "./showcase";

export type AdminItem = { id: string; product: string; genre: string; title: string; artist: string | null; owner: string; status: string; featured: boolean; plays: number; reward: number; before: string | null; after: string; created: string };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Aguardando", tone: "warning" },
  approved: { label: "Na vitrine", tone: "success" },
  rejected: { label: "Recusado", tone: "neutral" },
  revoked: { label: "Retirado pelo dono", tone: "danger" },
};

async function act(body: Record<string, unknown>) {
  const r = await fetch("/api/admin/showcase", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Não foi possível.");
  return j;
}

export function AdminShowcase({ items }: { items: AdminItem[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, body: Record<string, unknown>, ok: string) => {
    setBusy(id);
    try {
      await act(body);
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => {
        const st = STATUS[it.status] ?? { label: it.status, tone: "neutral" as Tone };
        return (
          <Card key={it.id} className="grid gap-3 p-4 md:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={st.tone}>{st.label}</Badge>
                {it.featured && <Badge tone="warning">Destaque</Badge>}
                <span className="text-xs text-muted">{it.created}</span>
              </div>
              <p className="font-semibold">{it.title || "Sem título"}</p>
              <p className="text-xs text-muted">
                {PRODUCT_LABEL[it.product] ?? it.product}
                {it.genre ? ` · ${GENRE_LABEL[it.genre] ?? it.genre}` : ""} · {it.artist ?? "anônimo"} · {it.owner} · {it.plays} reproduções
                {it.reward ? ` · presente: ${it.reward} créditos` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {it.status !== "approved" && it.status !== "revoked" && (
                  <Button size="sm" loading={busy === it.id} onClick={() => void run(it.id, { action: "review", id: it.id, approve: true }, "Aprovado e publicado.")}>
                    <Check className="size-4" aria-hidden /> Aprovar
                  </Button>
                )}
                {it.status === "pending" && (
                  <Button size="sm" variant="secondary" onClick={() => void run(it.id, { action: "review", id: it.id, approve: false }, "Recusado.")}>
                    <X className="size-4" aria-hidden /> Recusar
                  </Button>
                )}
                {it.status === "approved" && (
                  <Button size="sm" variant="secondary" onClick={() => void run(it.id, { action: "feature", id: it.id, featured: !it.featured }, it.featured ? "Destaque removido." : "Destacado no topo.")}>
                    <Star className="size-4" aria-hidden /> {it.featured ? "Tirar destaque" : "Destacar"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => window.confirm("Apagar este item e os arquivos?") && void run(it.id, { action: "delete", id: it.id }, "Apagado.")}>
                  <Trash2 className="size-4" aria-hidden /> Apagar
                </Button>
              </div>
            </div>
            {it.before ? <BeforeAfterPlayer before={it.before} after={it.after} lufsBefore={null} lufsAfter={null} /> : <audio controls src={it.after} preload="none" className="w-full" />}
          </Card>
        );
      })}
      {!items.length && <p className="text-sm text-muted">Nada na vitrine ainda. Comece enviando os seus exemplos acima.</p>}
    </div>
  );
}

/** Exemplo próprio (já aprovado): título, estilo, artista e os dois trechos (antes opcional). */
export function AdminShowcaseCreate() {
  const toast = useToast();
  const router = useRouter();
  const before = useRef<HTMLInputElement>(null);
  const after = useRef<HTMLInputElement>(null);
  const [product, setProduct] = useState("mix_ia");
  const [genre, setGenre] = useState("worship");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  async function send() {
    const a = after.current?.files?.[0];
    const b = before.current?.files?.[0];
    if (!a) return toast.error("Escolha o trecho “depois” (até 30 s, M4A, MP3 ou WAV).");
    const ext = a.name.split(".").pop()!.toLowerCase();
    if (b && b.name.split(".").pop()!.toLowerCase() !== ext) return toast.error("Os dois trechos precisam ter o mesmo formato.");
    setBusy(0);
    try {
      const r = await act({ action: "create", product, genre, title, artist_name: artist, ext, after_bytes: a.size, before_bytes: b ? b.size : null });
      const xhr = () => new XMLHttpRequest();
      await put(r.uploads.after, a, (p: number) => setBusy(p * (b ? 50 : 100)), undefined, xhr);
      if (b && r.uploads.before) await put(r.uploads.before, b, (p: number) => setBusy(50 + p * 50), undefined, xhr);
      toast.success("Exemplo publicado na vitrine.");
      setTitle("");
      setArtist("");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const field = "h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm";
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="font-display text-lg font-semibold">Enviar um exemplo seu</h2>
      <p className="text-sm text-muted">Trechos de até 30 s (o mesmo momento da música), antes e depois. Só use produções suas ou de parceiros que autorizaram.</p>
      <div className="grid gap-2 md:grid-cols-4">
        <select value={product} onChange={(e) => setProduct(e.target.value)} className={field} aria-label="Produto">
          {Object.entries(PRODUCT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={genre} onChange={(e) => setGenre(e.target.value)} className={field} aria-label="Estilo">
          {Object.entries(GENRE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" maxLength={80} className={field} />
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artista (opcional)" maxLength={60} className={field} />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Antes (opcional)
          <input ref={before} type="file" accept=".m4a,.mp3,.wav" className="text-xs" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Depois
          <input ref={after} type="file" accept=".m4a,.mp3,.wav" className="text-xs" />
        </label>
      </div>
      {busy !== null ? <ProgressBar value={busy} label="Enviando" /> : <Button className="self-start" onClick={() => void send()}>Publicar exemplo</Button>}
    </Card>
  );
}
