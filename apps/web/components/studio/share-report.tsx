"use client";

import { useState } from "react";
import { FileText, Link2 } from "lucide-react";
import { DELIVERY_TARGETS, type DeliveryId } from "@mixpro/contracts";
import type { ABSource } from "@/components/audio/ab-player";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { measureAudio } from "@/lib/dsp/diagnose";
import type { Signal } from "@/lib/dsp/types";
import type { Diagnosis } from "@/lib/dsp/diagnose-runner";
import type { LoadedMedia } from "@/lib/media/load";
import { buildReport } from "@/lib/report/build";
import { createShareLink } from "@/lib/share/client";
import { downloadBlob } from "@/lib/download";
import { reportError } from "@/lib/error-log";
import { supabaseBrowser } from "@/lib/supabase/client";
import { track } from "@/lib/track";

type Props = {
  media: LoadedMedia;
  original: ABSource;
  processed: ABSource;
  diagnosis: Diagnosis | null;
  presetName: string | null;
  delivery: DeliveryId | null;
  requireLogin: (why: string) => Promise<boolean>;
  onNeedCredits: () => void;
  onBalanceChange: () => Promise<void> | void;
};

/** Mede no máximo 90 s do trecho (o mesmo trecho no antes e no depois). */
const MAX_S = 90;
function signalOf(b: AudioBuffer): Signal {
  const n = Math.min(b.length, Math.round(MAX_S * b.sampleRate));
  return Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice(0, n)) as Signal;
}

/** Ref estável do relatório: baixar de novo o mesmo resultado não cobra outra vez. */
function reportRef(media: LoadedMedia, processed: ABSource): string {
  let h = 2166136261;
  for (const ch of `${media.file.name}|${media.file.size}|${media.file.lastModified}|${processed.key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `rp_${h.toString(16)}_${Math.round(media.file.size / 1000)}`;
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 60) || "audio";

/** Depois da prévia: link antes/depois (24 h) e relatório técnico em PDF. */
export function ShareReport(p: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState<"share" | "report" | null>(null);
  const [progress, setProgress] = useState(0);

  async function share() {
    if (!(await p.requireLogin("Entre na sua conta para criar o link de antes e depois."))) return;
    setBusy("share");
    setProgress(0);
    try {
      const url = await createShareLink(
        {
          before: p.original.buffer,
          after: p.processed.buffer,
          // o nome do arquivo nunca sai do aparelho (política de privacidade): a página mostra "Antes e depois"
          title: "",
          preset: p.presetName ?? "",
          lufsBefore: p.original.lufs,
          lufsAfter: p.processed.lufs,
        },
        setProgress,
      );
      track("share_page");
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (nav.share) {
        await nav.share({ title: "Ouça o antes e depois", text: "Olha a diferença no meu áudio com o Mix Pro:", url }).catch(() => {});
      } else {
        await navigator.clipboard?.writeText(url);
        toast.success("Link copiado! Ele vale 24 horas.");
      }
    } catch (e) {
      reportError("compartilhar-antes-depois", e, { severity: "aviso" });
      toast.error(e instanceof Error && e.message ? e.message : "Não foi possível criar o link agora.");
    } finally {
      setBusy(null);
    }
  }

  async function report() {
    if (!(await p.requireLogin("Entre na sua conta para baixar o relatório técnico."))) return;
    setBusy("report");
    try {
      const sb = supabaseBrowser();
      const { error } = await sb.rpc("spend_report_credit", { p_ref: reportRef(p.media, p.processed) });
      if (error) {
        if (String(error.message ?? "").includes("INSUFFICIENT_CREDITS")) return p.onNeedCredits();
        throw new Error(error.message);
      }
      void p.onBalanceChange();
      const before = measureAudio(signalOf(p.original.buffer), p.original.buffer.sampleRate);
      const after = measureAudio(signalOf(p.processed.buffer), p.processed.buffer.sampleRate);
      const measured = Math.min(MAX_S, p.original.buffer.duration);
      const d = p.delivery ? DELIVERY_TARGETS[p.delivery] : null;
      const bytes = buildReport({
        fileName: p.media.file.name,
        kind: p.media.kind,
        createdAt: new Date(),
        preset: p.presetName,
        delivery: d ? { label: d.label, targetLufs: d.targetLufs, ceilingDb: d.ceilingDb } : null,
        before,
        after,
        findings: p.diagnosis?.findings ?? [],
        musical: p.diagnosis?.musical ?? null,
        excerptS: measured < p.media.duration - 1 ? measured : null,
      });
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${baseName(p.media.file.name)}-relatorio-mixpro.pdf`);
      track("report_pdf");
    } catch (e) {
      reportError("relatorio-pdf", e, { severity: "aviso" });
      toast.error("Não foi possível gerar o relatório agora. Nenhum crédito extra foi usado.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => void share()} loading={busy === "share"} disabled={busy !== null}>
        <Link2 className="size-4" aria-hidden /> {busy === "share" ? `Criando link… ${Math.round(progress * 100)}%` : "Link antes/depois (24 h)"}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void report()} loading={busy === "report"} disabled={busy !== null}>
        <FileText className="size-4" aria-hidden /> Relatório PDF
      </Button>
      <p className="w-full text-xs text-subtle">O link é grátis. O relatório usa 1 crédito (grátis no Plano Pro); baixar de novo o mesmo não cobra.</p>
    </div>
  );
}
