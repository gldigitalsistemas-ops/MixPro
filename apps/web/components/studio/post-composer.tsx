"use client";

import { Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { NICHES, PLATFORMS, type NicheId, type Platform } from "@/lib/captions/niches";
import { cn } from "@/lib/cn";

const KEY_NICHE = "mixpro.niche";
const KEY_PLATFORM = "mixpro.platform";

/** Nicho e plataforma lembrados no aparelho (a pessoa costuma postar sempre no mesmo nicho). */
export function storedNiche(): NicheId | null {
  try {
    const v = localStorage.getItem(KEY_NICHE);
    return NICHES.some((n) => n.id === v) ? (v as NicheId) : null;
  } catch {
    return null;
  }
}
export function storedPlatform(): Platform | null {
  try {
    const v = localStorage.getItem(KEY_PLATFORM);
    return PLATFORMS.some((p) => p.id === v) ? (v as Platform) : null;
  } catch {
    return null;
  }
}
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export function PostComposer({
  niche,
  onNiche,
  platform,
  onPlatform,
  text,
  onText,
  onAnother,
  hasSpeech,
}: {
  niche: NicheId | null;
  onNiche: (n: NicheId) => void;
  platform: Platform;
  onPlatform: (p: Platform) => void;
  text: string;
  onText: (t: string) => void;
  onAnother: () => void;
  hasSpeech: boolean;
}) {
  const toast = useToast();
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-lg font-semibold">Descrição do post</h2>
        <p className="text-xs text-muted">
          {hasSpeech
            ? "Montada com a sua fala, o seu nicho e as hashtags certas para a plataforma."
            : "Montada com o seu nicho e as hashtags certas. Gere as legendas para usar também a sua fala."}
        </p>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Seu nicho
        <select
          value={niche ?? ""}
          onChange={(e) => {
            const v = e.target.value as NicheId;
            remember(KEY_NICHE, v);
            onNiche(v);
          }}
          className="h-10 rounded-xl border border-border-strong bg-black/20 px-2 text-sm text-text outline-none focus:border-violet-400"
        >
          {!niche && <option value="">Escolha o seu nicho…</option>}
          {NICHES.map((n) => (
            <option key={n.id} value={n.id}>
              {n.emoji} {n.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Plataforma">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={platform === p.id}
            onClick={() => {
              remember(KEY_PLATFORM, p.id);
              onPlatform(p.id);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              platform === p.id ? "border-violet-400 bg-primary/20 text-text" : "border-border text-muted hover:text-text",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={6}
        aria-label="Texto do post"
        className="rounded-xl border border-border-strong bg-black/20 p-3 text-sm text-text outline-none focus:border-violet-400"
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" onClick={onAnother}>
          <RefreshCw className="size-4" /> Outra sugestão
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            navigator.clipboard.writeText(text).then(
              () => toast.success("Descrição copiada. É só colar no post."),
              () => toast.error("Não foi possível copiar. Selecione o texto e copie."),
            )
          }
        >
          <Copy className="size-4" /> Copiar
        </Button>
      </div>
      <p className="text-[11px] text-subtle">
        {PLATFORMS.find((p) => p.id === platform)?.label}: {PLATFORMS.find((p) => p.id === platform)?.tags} hashtags certeiras funcionam
        melhor que muitas genéricas.
      </p>
    </div>
  );
}
