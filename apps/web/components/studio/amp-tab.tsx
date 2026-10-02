"use client";

import { useState } from "react";
import { AMP_MODELS } from "@mixpro/contracts";
import { cn } from "@/lib/cn";
import type { CabIR } from "@/lib/drums/library";
import { isBuiltinCab } from "@/lib/dsp/cab-ir";
import { ampGroup, type AmpChoice } from "@/lib/mix";

/**
 * Aba "Amplificadores": amplificador e caixa (IR) para guitarra e baixo plugados, aplicados no som
 * atual. As caixas enviadas no admin aparecem aqui junto com as do Mix Pro.
 */
export function AmpTab({ value, irs, onChange }: { value: AmpChoice; irs: CabIR[] | null; onChange: (v: AmpChoice) => void }) {
  const [group, setGroup] = useState<"guitar" | "bass">(() => (value ? ampGroup(value.model) : "guitar"));
  const models = AMP_MODELS.filter((m) => m.group === group);
  const cabs = (irs ?? []).filter((i) => i.kind === group);
  const own = cabs.filter((i) => !isBuiltinCab(i.id));
  const builtin = cabs.filter((i) => isBuiltinCab(i.id));
  const current = value && ampGroup(value.model) === group ? value : null;
  const pickModel = (model: string) => onChange({ model, ir: current?.ir ?? builtin[0]?.id ?? "" });
  const pickCab = (ir: string) => onChange({ model: current?.model ?? models[0].value, ir });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Para guitarra e baixo <b>plugados no cabo</b> (interface, pedaleira ou cabo no celular). O amplificador entra antes da equalização e
        da compressão do preset. Gravou o amplificador com o celular? Deixe <b>sem amplificador</b>.
      </p>

      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border p-1 text-sm" role="tablist" aria-label="Instrumento do amplificador">
        {(["guitar", "bass"] as const).map((g) => (
          <button
            key={g}
            role="tab"
            aria-selected={group === g}
            onClick={() => setGroup(g)}
            className={cn("rounded-xl py-2 font-medium", group === g ? "bg-white/12 text-text" : "text-muted hover:text-text")}
          >
            {g === "guitar" ? "Guitarra" : "Baixo"}
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Amplificador</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <Option selected={!value} title="Sem amplificador" hint="O som como foi gravado (celular, microfone ou amp gravado)." onClick={() => onChange(null)} />
          {models.map((m) => (
            <Option key={m.value} selected={current?.model === m.value} title={m.label} hint={m.hint} onClick={() => pickModel(m.value)} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Caixa e microfone</h3>
        {irs === null ? (
          <p className="text-sm text-muted">Carregando as caixas…</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {own.length > 0 && <p className="col-span-full text-xs text-violet-200">Caixas gravadas em estúdio</p>}
            {own.map((c) => (
              <Option key={c.id} selected={current?.ir === c.id} title={c.name} hint={c.description ?? "Caixa gravada em estúdio."} onClick={() => pickCab(c.id)} />
            ))}
            <p className="col-span-full text-xs text-violet-200">Caixas do Mix Pro</p>
            {builtin.map((c) => (
              <Option key={c.id} selected={current?.ir === c.id} title={c.name} hint={c.description ?? ""} onClick={() => pickCab(c.id)} />
            ))}
            <Option selected={Boolean(current) && !current?.ir} title="Caixa simulada" hint="A caixa básica do amplificador (mais leve)." onClick={() => pickCab("")} />
          </div>
        )}
      </section>
    </div>
  );
}

function Option({ selected, title, hint, onClick }: { selected: boolean; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn("rounded-xl border p-2.5 text-left transition", selected ? "border-violet-400 bg-primary/15" : "border-border hover:bg-white/5")}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="block text-[11px] text-muted">{hint}</span>
    </button>
  );
}
