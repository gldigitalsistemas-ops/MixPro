"use client";

import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { AMP_MODELS, MODULES, type ModuleType, type NumberParam, type ParamSpec } from "@mixpro/contracts";
import type { ChainDoc, ChainStep } from "@/lib/dsp/chain";
import { cn } from "@/lib/cn";
import type { CabIR } from "@/lib/drums/library";
import { isBuiltinCab } from "@/lib/dsp/cab-ir";

/** Ajustes técnicos que ficam em "Mais ajustes" para não assustar quem está começando. */
const ADVANCED = new Set(["knee_db", "lookahead_ms", "hold_ms", "predelay_ms", "width", "damping", "bass_mono_hz", "output_db", "slope_db_oct", "lowpass_hz", "blend", "level_db", "cabinet"]);

/** Efeitos que o usuário pode acrescentar (o amplificador entra no começo da cadeia). */
const ADDABLE: ModuleType[] = [
  "amp",
  "overdrive",
  "chorus",
  "octaver",
  "gate",
  "eq_peak",
  "eq_shelf",
  "highpass",
  "lowpass",
  "compressor",
  "saturation",
  "delay",
  "reverb",
  "stereo_width",
];

/** Pedais entram antes do amplificador, como na pedaleira. */
const PEDALS = new Set<string>(["overdrive", "chorus", "octaver"]);

/** Descrição curta de cada efeito, na língua do músico. */
const HINT: Partial<Record<ModuleType, string>> = {
  amp: "Guitarra ou baixo ligado direto: escolha o amplificador e gire os botões como num amp de verdade.",
  overdrive: "Pedal de drive antes do amp: aperta o grave e dá mais sustain.",
  chorus: "Dobra o som com leve variação: guitarra mais larga e brilhante.",
  octaver: "Soma uma oitava abaixo: baixo mais gordo ou guitarra com peso.",
  gate: "Corta o chiado e o ruído entre as notas.",
  highpass: "Tira o grave que embola.",
  lowpass: "Tira o agudo que fere.",
  eq_peak: "Realça ou tira uma região do som.",
  eq_shelf: "Mais ou menos grave/agudo de forma ampla.",
  compressor: "Deixa o volume mais constante e o som mais \"na cara\".",
  saturation: "Calor e sujeira de fita ou válvula.",
  delay: "Repetições do som.",
  reverb: "Ambiência: de sala pequena a igreja.",
  stereo_width: "Abre ou fecha o estéreo.",
  limiter: "Segura os picos e deixa o som mais alto.",
};

function defaultStep(type: ModuleType): ChainStep {
  const params: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(MODULES[type].params) as [string, ParamSpec][]) params[name] = p.default;
  if (type === "reverb" || type === "delay") params.mix = 15;
  if (type === "saturation") params.mix = 50;
  return { type, params };
}

/** Frequências: o controle anda em escala logarítmica (como nos plugins). */
const isLog = (p: NumberParam) => p.unit === "Hz" && p.max / Math.max(1, p.min) > 20;
const toPos = (v: number, p: NumberParam) => (isLog(p) ? (Math.log(v / p.min) / Math.log(p.max / p.min)) * 1000 : v);
const fromPos = (pos: number, p: NumberParam) => {
  if (!isLog(p)) return pos;
  const v = p.min * (p.max / p.min) ** (pos / 1000);
  return v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v);
};
const fmt = (v: number, p: NumberParam) =>
  p.unit === "Hz" && v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v * 10) / 10}${p.unit ? ` ${p.unit}` : ""}`;

function ParamControl({ name, spec, value, onChange }: { name: string; spec: ParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  if (spec.kind === "sample") return null;
  if (spec.kind === "enum") {
    return (
      <label className="flex flex-col gap-1 text-xs text-muted">
        {spec.label}
        <select
          value={String(value ?? spec.default)}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 rounded-lg border border-border-strong bg-black/20 px-2 text-sm text-text outline-none focus:border-violet-400"
        >
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const v = typeof value === "number" ? value : spec.default;
  const log = isLog(spec);
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      <span className="flex justify-between gap-2">
        {spec.label}
        <span className="tabular-nums text-text">{fmt(v, spec)}</span>
      </span>
      <input
        type="range"
        min={log ? 0 : spec.min}
        max={log ? 1000 : spec.max}
        step={log ? 1 : spec.step}
        value={toPos(v, spec)}
        onChange={(e) => onChange(fromPos(Number(e.target.value), spec))}
        aria-label={`${spec.label} (${name})`}
        className="accent-violet-500"
      />
    </label>
  );
}

function AmpPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const group = AMP_MODELS.find((m) => m.value === value)?.group ?? "guitar";
  const [show, setShow] = useState<"guitar" | "bass">(group);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 text-xs">
        {(["guitar", "bass"] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setShow(g)}
            className={cn("rounded-full px-3 py-1 font-medium", show === g ? "bg-white/12 text-text" : "text-muted hover:text-text")}
          >
            {g === "guitar" ? "Guitarra" : "Baixo"}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {AMP_MODELS.filter((m) => m.group === show).map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={value === m.value}
            onClick={() => onChange(m.value)}
            className={cn(
              "rounded-xl border p-2.5 text-left transition",
              value === m.value ? "border-violet-400 bg-primary/15" : "border-border hover:bg-white/5",
            )}
          >
            <span className="block text-sm font-semibold">{m.label}</span>
            <span className="block text-[11px] text-muted">{m.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function IrPicker({ value, irs, group, onChange }: { value: string; irs: CabIR[]; group: "guitar" | "bass"; onChange: (v: string) => void }) {
  const list = irs.filter((i) => i.kind === group);
  if (!list.length) return null;
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      Caixa e microfone (IR)
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-border-strong bg-black/20 px-2 text-sm text-text outline-none focus:border-violet-400"
      >
        <option value="">Caixa simulada (do amplificador)</option>
        {[
          { label: "Caixas do Mix Pro", items: list.filter((i) => isBuiltinCab(i.id)) },
          { label: "Caixas gravadas em estúdio", items: list.filter((i) => !isBuiltinCab(i.id)) },
        ]
          .filter((g) => g.items.length)
          .map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      <span className="text-[11px] text-subtle">
        {list.find((i) => i.id === value)?.description ?? "Escolha uma caixa e um microfone: o som fica mais real que a caixa simulada."}
      </span>
    </label>
  );
}

function ModuleCard({
  step,
  irs,
  onChange,
  onRemove,
}: {
  step: ChainStep;
  irs: CabIR[];
  onChange: (s: ChainStep) => void;
  onRemove: () => void;
}) {
  const [more, setMore] = useState(false);
  const type = step.type as ModuleType;
  const spec = MODULES[type];
  const entries = Object.entries(spec.params) as [string, ParamSpec][];
  const basic = entries.filter(([n, p]) => !ADVANCED.has(n) && p.kind !== "sample" && !(type === "amp" && n === "model"));
  const advanced = entries.filter(([n, p]) => ADVANCED.has(n) && p.kind !== "sample");
  const set = (name: string, v: unknown) => onChange({ ...step, params: { ...step.params, [name]: v } });
  const on = !step.bypass;

  return (
    <li className={cn("rounded-2xl border border-border p-3", !on && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{spec.label}</p>
          <p className="text-[11px] text-muted">{HINT[type] ?? spec.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`${on ? "Desligar" : "Ligar"} ${spec.label}`}
            onClick={() => onChange({ ...step, bypass: on ? true : undefined })}
            className={cn("relative h-6 w-10 rounded-full transition", on ? "bg-violet-500" : "bg-white/15")}
          >
            <span className={cn("absolute top-0.5 size-5 rounded-full bg-white transition-all", on ? "left-[1.1rem]" : "left-0.5")} />
          </button>
          <button type="button" onClick={onRemove} aria-label={`Remover ${spec.label}`} className="rounded-full p-1.5 text-muted hover:bg-white/5 hover:text-red-300">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {on && (
        <div className="mt-3 flex flex-col gap-3">
          {type === "amp" && <AmpPicker value={String(step.params?.model ?? "clean_us")} onChange={(v) => set("model", v)} />}
          {type === "amp" && (
            <IrPicker
              value={String(step.params?.ir ?? "")}
              irs={irs}
              group={AMP_MODELS.find((m) => m.value === step.params?.model)?.group ?? "guitar"}
              onChange={(v) => set("ir", v)}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {basic.map(([name, p]) => (
              <ParamControl key={name} name={name} spec={p} value={step.params?.[name]} onChange={(v) => set(name, v)} />
            ))}
          </div>
          {advanced.length > 0 && (
            <>
              <button type="button" onClick={() => setMore(!more)} className="flex items-center gap-1 self-start text-xs text-muted hover:text-text">
                <ChevronDown className={cn("size-3.5 transition", more && "rotate-180")} /> Mais ajustes
              </button>
              {more && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {advanced.map(([name, p]) => (
                    <ParamControl key={name} name={name} spec={p} value={step.params?.[name]} onChange={(v) => set(name, v)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Editor da cadeia para o usuário: cada efeito com botões de verdade, sem jargão de JSON. */
export function PresetCustomizer({ chain, irs = [], onChange }: { chain: ChainDoc; irs?: CabIR[]; onChange: (c: ChainDoc) => void }) {
  const steps = chain.chain;
  const update = (i: number, s: ChainStep) => onChange({ ...chain, chain: steps.map((x, j) => (j === i ? s : x)) });
  const remove = (i: number) => onChange({ ...chain, chain: steps.filter((_, j) => j !== i) });

  function add(type: ModuleType) {
    const s = defaultStep(type);
    const next = [...steps];
    if (type === "gate") {
      // o gate vai antes do amplificador (ou no começo)
      let i = next.findIndex((x) => x.type === "amp");
      if (i < 0) {
        i = 0;
        while (i < next.length && next[i].type === "drum_studio") i++;
      }
      next.splice(i, 0, s);
    } else if (type === "amp") {
      // o amplificador vem antes da equalização e da compressão (gate e pedais ficam antes dele)
      let i = 0;
      while (i < next.length && (next[i].type === "gate" || next[i].type === "drum_studio" || PEDALS.has(next[i].type))) i++;
      next.splice(i, 0, s);
    } else if (PEDALS.has(type)) {
      // pedal: logo antes do amplificador (ou no começo, depois do gate)
      let i = next.findIndex((x) => x.type === "amp");
      if (i < 0) {
        i = 0;
        while (i < next.length && (next[i].type === "gate" || next[i].type === "drum_studio" || PEDALS.has(next[i].type))) i++;
      }
      next.splice(i, 0, s);
    } else {
      // antes do limiter final, se houver
      const lim = next.length - 1;
      next.splice(lim >= 0 && next[lim].type === "limiter" ? lim : next.length, 0, s);
    }
    onChange({ ...chain, chain: next });
  }

  const hasAmp = steps.some((s) => s.type === "amp");
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {steps.map((s, i) =>
          s.type === "drum_studio" || !(s.type in MODULES) ? null : (
            <ModuleCard key={`${s.type}-${i}`} step={s} irs={irs} onChange={(x) => update(i, x)} onRemove={() => remove(i)} />
          ),
        )}
      </ul>
      <label className="flex items-center gap-2 text-sm">
        <Plus className="size-4 text-violet-300" />
        <select
          value=""
          onChange={(e) => e.target.value && add(e.target.value as ModuleType)}
          className="h-10 flex-1 rounded-xl border border-border-strong bg-black/20 px-2 text-sm text-text outline-none focus:border-violet-400"
          aria-label="Adicionar efeito"
        >
          <option value="">Adicionar efeito…</option>
          {ADDABLE.filter((t) => !(t === "amp" && hasAmp)).map((t) => (
            <option key={t} value={t}>
              {MODULES[t].label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
