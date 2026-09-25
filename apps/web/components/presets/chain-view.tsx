"use client";

import { MODULES, resolveParam, type ModuleType, type NumberParam, type ParamSpec, type PresetChain } from "@mixpro/contracts";

function fmt(v: number, unit?: string) {
  const n = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${n.toLocaleString("pt-BR")}${unit ? ` ${unit}` : ""}`;
}

/** Visualização da cadeia DSP. Simples: rótulos leigos. Profissional: parâmetros resolvidos na intensidade. */
export function ChainView({ chain, intensity, pro }: { chain: PresetChain | null; intensity: number; pro: boolean }) {
  const mods = (chain?.chain ?? []).filter((m) => !m.bypass);
  if (mods.length === 0) return <p className="text-sm text-muted">Este preset ainda não tem processamento configurado.</p>;

  if (!pro) {
    return (
      <ul className="flex flex-wrap gap-2">
        {mods.map((m, i) => (
          <li key={i} className="rounded-full bg-white/6 px-3 py-1 text-xs text-muted">
            {m.label || MODULES[m.type as ModuleType].description}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {mods.map((m, i) => {
        const spec = MODULES[m.type as ModuleType];
        const params = (m.params ?? {}) as Record<string, unknown>;
        return (
          <li key={i} className="rounded-xl border border-border bg-black/20 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">
                <span className="mr-2 text-subtle tabular-nums">{i + 1}.</span>
                {spec.label}
              </span>
              {m.label && <span className="text-xs text-violet-300">{m.label}</span>}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              {(Object.entries(spec.params) as [string, ParamSpec][]).map(([name, p]) => {
                const value =
                  p.kind === "enum"
                    ? (p.options.find((o) => o.value === (params[name] ?? p.default))?.label ?? String(params[name]))
                    : fmt(resolveParam(params[name] as never, p as NumberParam, intensity), p.unit);
                return (
                  <div key={name} className="flex justify-between gap-2">
                    <dt className="text-subtle">{p.label}</dt>
                    <dd className="tabular-nums text-muted">{value}</dd>
                  </div>
                );
              })}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}
