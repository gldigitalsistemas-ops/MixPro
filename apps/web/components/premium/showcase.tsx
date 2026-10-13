"use client";

import { useEffect, useState } from "react";
import { Gift, Sparkles } from "lucide-react";
import { BeforeAfterPlayer } from "@/app/ouvir/[token]/player";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { revokeShowcase, shareToShowcase } from "@/lib/premium/client";
import { cn } from "@/lib/cn";

type Item = { id: string; product: string; genre: string; title: string; artist: string | null; before: string | null; after: string; featured: boolean };

export const PRODUCT_LABEL: Record<string, string> = {
  estudio: "Estúdio",
  vs_premium: "VS Premium",
  mix_ia: "Mix & Master IA",
  producao: "Produção",
  voz_final: "Voz finalizada",
};

export const GENRE_LABEL: Record<string, string> = {
  pop: "Pop",
  pop_us: "Pop americano",
  worship: "Worship",
  gospel: "Gospel",
  sertanejo: "Sertanejo",
  pagode: "Pagode/Samba",
  funk: "Funk",
  rock: "Rock",
  trap: "Trap/Hip-hop",
  acoustic: "Acústico",
  edm: "Eletrônica",
  lofi: "Lo-fi",
  mpb: "MPB",
};

/** Vitrine: antes e depois de produções reais (só com autorização de quem fez). */
export function ShowcaseStrip({ product, title = "Ouça o antes e depois de quem já usou", limit = 6 }: { product?: string; title?: string; limit?: number }) {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    fetch(`/api/showcase?limite=${limit}${product ? `&produto=${product}` : ""}`)
      .then((r) => r.json())
      .then((b: { items?: Item[] }) => setItems(b.items ?? []))
      .catch(() => setItems([]));
  }, [product, limit]);
  if (!items?.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
        <Sparkles className="size-5 text-amber-300" aria-hidden /> {title}
      </h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <Card key={it.id} className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-violet-300">
                {PRODUCT_LABEL[it.product] ?? it.product}
                {it.genre ? ` · ${GENRE_LABEL[it.genre] ?? it.genre}` : ""}
              </p>
              <p className="font-semibold">{it.title || "Produção"}</p>
              {it.artist && <p className="text-xs text-muted">{it.artist}</p>}
            </div>
            <div onClickCapture={() => void fetch(`/api/showcase/${it.id}/play`, { method: "POST" }).catch(() => {})}>
              {it.before ? (
                <BeforeAfterPlayer before={it.before} after={it.after} lufsBefore={null} lufsAfter={null} />
              ) : (
                <audio controls src={it.after} preload="none" className="w-full" />
              )}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

/**
 * Autorização da vitrine na entrega (caixa desmarcada; não é condição para baixar). Com a aprovação,
 * a pessoa ganha créditos de presente. Dá para retirar a qualquer momento.
 */
export function ShowcaseConsent({ projectId, reward, defaultGenre, existing, onChange }: { projectId: string; reward: number; defaultGenre?: string; existing?: { id: string; status: string } | null; onChange?: () => void }) {
  const toast = useToast();
  const [agree, setAgree] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState(defaultGenre ?? "");
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState(existing ?? null);

  if (item && item.status !== "revoked") {
    return (
      <Card className="flex flex-col gap-2 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-amber-300" aria-hidden /> {item.status === "approved" ? "Seu trecho está na vitrine" : "Autorização enviada para a vitrine"}
        </p>
        <p className="text-muted">
          {item.status === "approved" ? "Obrigado! Os créditos de presente já estão na sua conta." : `Assim que aprovarmos, o trecho aparece na vitrine e você ganha ${reward} créditos.`}
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await revokeShowcase(item.id);
              setItem({ ...item, status: "revoked" });
              toast.success("Autorização retirada. O trecho saiu da vitrine.");
              onChange?.();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Retirar autorização
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        <Gift className="size-4 text-amber-300" aria-hidden /> Mostre o seu resultado e ganhe {reward} créditos
      </p>
      <p className="text-muted">
        Autorize um trecho de 30 segundos (antes e depois) na vitrine do Mix Pro. É opcional, não muda nada na sua entrega e você pode retirar quando quiser.
      </p>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 accent-violet-500" />
        <span>Autorizo o Mix Pro a mostrar um trecho de 30 s desta produção na vitrine, para divulgação, sem custo e com a música continuando minha.</span>
      </label>
      {agree && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            Estilo
            <select value={genre} onChange={(e) => setGenre(e.target.value)} className="h-10 rounded-xl border border-border-strong bg-black/20 px-2">
              <option value="">—</option>
              {Object.entries(GENRE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!anonymous} onChange={(e) => setAnonymous(!e.target.checked)} className="size-4 accent-violet-500" />
              Mostrar meu nome artístico
            </label>
            <input
              disabled={anonymous}
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              maxLength={60}
              placeholder="Nome artístico"
              className={cn("h-10 rounded-xl border border-border-strong bg-black/20 px-3", anonymous && "opacity-50")}
            />
          </div>
        </div>
      )}
      <Button
        size="sm"
        className="self-start"
        disabled={!agree}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await shareToShowcase(projectId, { genre, anonymous, artist_name: anonymous ? undefined : artist });
            setItem({ id: r.item_id, status: "pending" });
            toast.success("Obrigado! Vamos ouvir e publicar em breve.");
            onChange?.();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Autorizar na vitrine
      </Button>
    </Card>
  );
}
