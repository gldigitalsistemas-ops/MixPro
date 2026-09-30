"use client";

import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import type { DrumSlot } from "@/lib/dsp/drums/studio";
import { optionsFor, resolveSample, sampleUrl, SLOT_LABEL, SLOT_PARAM, type DrumLibraryItem } from "@/lib/drums/library";
import type { LoadedMedia } from "@/lib/media/load";
import { cn } from "@/lib/cn";

const SLOTS: DrumSlot[] = ["kick", "snare", "tom1", "tom2", "floor"];

export type DrumTweaks = {
  samples: Record<DrumSlot, string>;
  kick: number;
  snare: number;
  toms: number;
  floor: number;
  sample_mix: number;
  reverb_size: string;
  reverb: number;
};

/** Volume de cada peça (os dois tons dividem o mesmo controle). */
const VOLUME: Partial<Record<DrumSlot, "kick" | "snare" | "toms" | "floor">> = { kick: "kick", snare: "snare", tom1: "toms", floor: "floor" };

const SIZES = [
  { value: "small", label: "Small", hint: "sala pequena" },
  { value: "medium", label: "Médio", hint: "estúdio" },
  { value: "large", label: "Large", hint: "igreja / arena" },
];

const numOf = (v: unknown, d: number) =>
  typeof v === "number" ? v : typeof (v as { value?: number })?.value === "number" ? (v as { value: number }).value : d;

/** Valores do preset (drum_studio), com os samples resolvidos pela biblioteca. */
export function drumDefaults(params: Record<string, unknown>, library: DrumLibraryItem[]): DrumTweaks {
  const kit = typeof params.kit === "string" ? params.kit : "poprock";
  const samples = {} as Record<DrumSlot, string>;
  for (const slot of SLOTS) samples[slot] = resolveSample(slot, String(params[SLOT_PARAM[slot]] ?? ""), kit, library);
  return {
    samples,
    kick: numOf(params.kick, 0),
    snare: numOf(params.snare, 0),
    toms: numOf(params.toms, 0),
    floor: numOf(params.floor, 0),
    sample_mix: numOf(params.sample_mix, 60),
    reverb_size: typeof params.reverb_size === "string" ? params.reverb_size : "medium",
    reverb: numOf(params.reverb, 25),
  };
}

/** Aplica as escolhas na cadeia do preset (mantendo o resto igual). */
export function withDrumTweaks<T extends { chain: { type: string; params?: Record<string, unknown> }[] }>(doc: T, t: DrumTweaks | null): T {
  if (!t) return doc;
  return {
    ...doc,
    chain: doc.chain.map((m) =>
      m.type === "drum_studio"
        ? {
            ...m,
            params: {
              ...m.params,
              ...Object.fromEntries(SLOTS.map((s) => [SLOT_PARAM[s], t.samples[s]])),
              kick: t.kick,
              snare: t.snare,
              toms: t.toms,
              floor: t.floor,
              sample_mix: { value: t.sample_mix, neutral: 0 },
              reverb_size: t.reverb_size,
              reverb: { value: t.reverb, neutral: 0 },
            },
          }
        : m,
    ),
  };
}

const sameTweaks = (a: DrumTweaks, b: DrumTweaks) => JSON.stringify(a) === JSON.stringify(b);

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      <span className="flex justify-between">
        {label}
        <span className="tabular-nums text-text">
          {unit === "dB" && value > 0 ? "+" : ""}
          {value} {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-violet-500"
      />
    </label>
  );
}

export function DrumPanel({
  media,
  library,
  value,
  defaults,
  onChange,
  loading,
}: {
  media: LoadedMedia;
  library: DrumLibraryItem[] | null;
  value: DrumTweaks;
  defaults: DrumTweaks;
  onChange: (v: DrumTweaks) => void;
  /** Samples sendo baixados. */
  loading: boolean;
}) {
  const [counts, setCounts] = useState<Record<DrumSlot, number> | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // contagem das peças no arquivo inteiro (roda depois de pintar a tela)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const { analyzeDrums } = await import("@/lib/dsp/drums/studio");
      const r = analyzeDrums(media.channels, media.sampleRate);
      if (alive) setCounts(r.counts);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [media]);

  useEffect(() => () => audio.current?.pause(), []);

  function preview(item: DrumLibraryItem) {
    audio.current?.pause();
    if (playing === item.id) return setPlaying(null);
    // a camada mais forte costuma ser a última enviada; toca uma do meio para não assustar
    const a = new Audio(sampleUrl(item.files[Math.floor((item.files.length - 1) / 2)]));
    audio.current = a;
    a.onended = () => setPlaying(null);
    setPlaying(item.id);
    a.play().catch(() => setPlaying(null));
  }

  const set = (patch: Partial<DrumTweaks>) => onChange({ ...value, ...patch });
  const hasLibrary = Boolean(library?.length);
  const found = counts
    ? [
        counts.kick && `${counts.kick} bumbos`,
        counts.snare && `${counts.snare} caixas`,
        counts.tom1 + counts.tom2 && `${counts.tom1 + counts.tom2} tons`,
        counts.floor && `${counts.floor} no surdo`,
      ].filter(Boolean)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Sua bateria</h2>
          <p className="text-xs text-muted">
            {!found
              ? "Identificando as peças da bateria…"
              : found.length
                ? `Encontramos ${found.join(", ")}.`
                : "Poucas batidas encontradas — confira se o arquivo é de bateria."}
            {loading && " Baixando os samples…"}
          </p>
        </div>
        {!sameTweaks(value, defaults) && (
          <button type="button" onClick={() => onChange(defaults)} className="flex shrink-0 items-center gap-1 text-xs text-muted hover:text-text">
            <RotateCcw className="size-3.5" /> Padrão
          </button>
        )}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {SLOTS.map((slot) => {
          const opts = library ? optionsFor(slot, library) : [];
          const chosen = opts.find((o) => o.id === value.samples[slot]);
          const vol = VOLUME[slot];
          return (
            <li key={slot} className="flex flex-col gap-2 rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {SLOT_LABEL[slot]}
                  {counts && counts[slot] > 0 && <span className="ml-1.5 text-xs font-normal text-subtle">×{counts[slot]}</span>}
                </span>
                {chosen && (
                  <button
                    type="button"
                    onClick={() => preview(chosen)}
                    aria-label={playing === chosen.id ? "Parar" : `Ouvir ${chosen.name}`}
                    className="grid size-8 place-items-center rounded-full bg-white/8 text-text hover:bg-white/15"
                  >
                    {playing === chosen.id ? <Square className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
                  </button>
                )}
              </div>
              <select
                value={value.samples[slot]}
                onChange={(e) => set({ samples: { ...value.samples, [slot]: e.target.value } })}
                aria-label={`Som do ${SLOT_LABEL[slot]}`}
                className="h-10 rounded-xl border border-border-strong bg-black/20 px-2 text-sm text-text outline-none focus:border-violet-400"
              >
                {opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
                <option value="synth">Sintetizado do estilo</option>
              </select>
              {chosen?.description && <p className="text-[11px] text-subtle">{chosen.description}</p>}
              {vol ? (
                <Slider
                  label={slot === "tom1" ? "Volume dos tons" : "Volume"}
                  value={value[vol]}
                  min={-12}
                  max={12}
                  step={0.5}
                  unit="dB"
                  onChange={(v) => set({ [vol]: v })}
                />
              ) : (
                <p className="text-[11px] text-subtle">Volume junto com o Tom 1.</p>
              )}
            </li>
          );
        })}
      </ul>

      <Slider label="Som de estúdio (quanto dos samples entra)" value={value.sample_mix} min={0} max={100} step={5} unit="%" onChange={(v) => set({ sample_mix: v })} />

      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted">Reverb</span>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-border-strong p-1" role="group" aria-label="Tamanho do reverb">
          {SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={value.reverb_size === s.value}
              onClick={() => set({ reverb_size: s.value })}
              className={cn(
                "flex flex-col items-center rounded-lg py-1.5 text-xs font-semibold transition",
                value.reverb_size === s.value ? "bg-brand text-white" : "text-muted hover:text-text",
              )}
            >
              {s.label}
              <span className="text-[10px] font-normal opacity-80">{s.hint}</span>
            </button>
          ))}
        </div>
        <Slider label="Quantidade de reverb" value={value.reverb} min={0} max={100} step={5} unit="%" onChange={(v) => set({ reverb: v })} />
      </div>

      <p className="text-xs text-subtle">
        {hasLibrary
          ? "Cada bumbo, caixa, tom e surdo que você tocou dispara o sample escolhido, na mesma força da sua batida. Pratos e chimbal ficam como você gravou."
          : "Ainda não há samples de bateria na biblioteca: por enquanto o app usa timbres sintetizados do estilo. Pratos e chimbal ficam como você gravou."}
      </p>
    </div>
  );
}
