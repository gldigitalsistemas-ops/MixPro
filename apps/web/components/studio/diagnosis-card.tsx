"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Stethoscope, XCircle } from "lucide-react";
import type { Diagnosis } from "@/lib/dsp/diagnose-runner";
import type { FindingStatus } from "@/lib/dsp/diagnose";
import { cn } from "@/lib/cn";

const ICON: Record<FindingStatus, { Icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { Icon: CheckCircle2, cls: "text-emerald-400", label: "Ok" },
  warn: { Icon: AlertTriangle, cls: "text-amber-400", label: "Atenção" },
  bad: { Icon: XCircle, cls: "text-rose-400", label: "Problema" },
};

const num = (v: number | null, digits = 1, unit = "") => (v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}${unit}`);

export type DiagnosisState = { status: "loading" } | { status: "error" } | { status: "ready"; diagnosis: Diagnosis } | null;

/** Diagnóstico do arquivo antes de processar: tudo vem de medidas reais do sinal. */
export function DiagnosisCard({ state }: { state: DiagnosisState }) {
  const [open, setOpen] = useState(true);
  if (!state) return null;
  if (state.status === "error") return null; // o diagnóstico é só uma ajuda: sem ele, o resto continua
  if (state.status === "loading")
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border p-3 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Analisando o seu áudio…
      </div>
    );
  const { findings, measurements: m, analyzedS, totalS } = state.diagnosis;
  const attention = findings.filter((f) => f.status !== "ok").length;
  return (
    <div className="rounded-2xl border border-border p-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06]">
          <Stethoscope className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Diagnóstico do áudio</span>
          <span className="block text-xs text-muted">{attention ? `${attention} ponto${attention > 1 ? "s" : ""} de atenção` : "Nenhum problema encontrado"}</span>
        </span>
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {findings.map((f) => {
              const { Icon, cls, label } = ICON[f.status];
              return (
                <li key={f.id} className="flex items-start gap-2 text-sm">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", cls)} aria-label={label} />
                  <span>
                    <span className="font-medium">{f.label}</span>
                    <span className="block text-xs text-muted">{f.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            {[
              ["Loudness", num(m.lufs, 1, " LUFS")],
              ["Pico", num(m.peakDb, 1, " dBFS")],
              ["True peak", num(m.truePeakDb, 1, " dBTP")],
              ["RMS", num(m.rmsDb, 1, " dBFS")],
              ["Faixa (LRA)", num(m.lra, 1, " LU")],
              ["Fundo", num(m.noiseFloorDb, 0, " dBFS")],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-border/50 py-1">
                <dt className="text-muted">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </div>
            ))}
          </dl>
          {analyzedS < totalS - 1 && <p className="text-xs text-muted">Medido num trecho de {Math.round(analyzedS)} s do meio do arquivo (de {Math.round(totalS)} s).</p>}
        </div>
      )}
    </div>
  );
}
