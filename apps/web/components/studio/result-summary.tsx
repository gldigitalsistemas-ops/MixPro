"use client";

import { useMemo } from "react";
import { DELIVERY_TARGETS, type DeliveryId } from "@mixpro/contracts";
import { truePeak } from "@/lib/dsp/diagnose";
import { KIND_LABEL } from "@/lib/auto-setup";
import type { ContentKind } from "@/lib/dsp/analyze";
import type { ABSource } from "@/components/audio/ab-player";
import { formatDuration } from "@/lib/cn";

const fmt = (v: number | null, unit: string, digits = 1) => (v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)} ${unit}`);

/**
 * Resumo do resultado da prévia: só medidas reais do áudio ouvido (o trecho da prévia), nada estimado.
 * O true peak é medido com oversampling de 4× no áudio tratado.
 */
export function ResultSummary({
  original,
  processed,
  kind,
  delivery,
  volumeOn,
}: {
  original: ABSource | null;
  processed: ABSource | null;
  kind: ContentKind | null;
  delivery: DeliveryId;
  volumeOn: boolean;
}) {
  const tp = useMemo(() => {
    if (!processed) return null;
    const ch = Array.from({ length: processed.buffer.numberOfChannels }, (_, c) => processed.buffer.getChannelData(c)) as Float32Array<ArrayBuffer>[];
    const v = truePeak(ch);
    return v > 0 ? 20 * Math.log10(v) : null;
  }, [processed]);
  if (!processed) return null;

  const rows: [string, string][] = [
    ["Tipo detectado", kind ? KIND_LABEL[kind] : "—"],
    ["Volume final", volumeOn ? DELIVERY_TARGETS[delivery].label : "Sem ajuste de volume"],
    ["Loudness", `${fmt(original?.lufs ?? null, "LUFS")} → ${fmt(processed.lufs, "LUFS")}`],
    ["True peak (depois)", fmt(tp, "dBTP")],
    ["Trecho medido", formatDuration(processed.buffer.duration)],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-2xl border border-border p-3 text-sm sm:grid-cols-2" aria-label="Resultado da prévia">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-border/50 py-1 last:border-0">
          <dt className="text-muted">{k}</dt>
          <dd className="font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
