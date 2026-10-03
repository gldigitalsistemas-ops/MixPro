"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Lock, Play, RotateCcw, Square } from "lucide-react";
import type { DrumSlot } from "@/lib/dsp/drums/studio";
import {
  hasRoomMics,
  KIT_FIELD,
  optionsFor,
  resolveSample,
  sampleUrl,
  SLOT_LABEL,
  SLOT_PARAM,
  type DrumKit,
  type DrumLibraryItem,
} from "@/lib/drums/library";
import type { LoadedMedia } from "@/lib/media/load";
import type { DrumTweaks } from "@/lib/drums/tweaks";

export { withDrumTweaks, type DrumTweaks } from "@/lib/drums/tweaks";
import { cn } from "@/lib/cn";

/** Peças com card próprio (o aro fica dentro do card da caixa). */
const SLOTS: Exclude<DrumSlot, "rimshot">[] = ["kick", "snare", "tom1", "tom2", "floor"];
const ALL_SLOTS: DrumSlot[] = [...SLOTS, "rimshot"];

type Volume = "kick" | "snare" | "toms" | "floor";
type Tune = "kick_tune" | "snare_tune" | "toms_tune" | "floor_tune";


/** Volume e afinação de cada peça (os dois tons dividem os mesmos controles). */
const CONTROLS: Record<Exclude<DrumSlot, "rimshot">, { volume?: Volume; tune?: Tune }> = {
  kick: { volume: "kick", tune: "kick_tune" },
  snare: { volume: "snare", tune: "snare_tune" },
  tom1: { volume: "toms", tune: "toms_tune" },
  tom2: {},
  floor: { volume: "floor", tune: "floor_tune" },
};

const numOf = (v: unknown, d: number) =>
  typeof v === "number" ? v : typeof (v as { value?: number })?.value === "number" ? (v as { value: number }).value : d;

/**
 * Samples de um kit. Peças que o kit não define: tom 2 usa o tom 1 do kit, o aro fica desligado
 * e as outras continuam como estavam (para não carregar uma peça paga do kit anterior).
 */
export function kitSamples(kit: DrumKit, library: DrumLibraryItem[], base: Record<DrumSlot, string>): Record<DrumSlot, string> {
  const out = { ...base };
  const valid = (id: unknown): id is string => typeof id === "string" && library.some((s) => s.id === id);
  for (const slot of ALL_SLOTS) {
    const id = kit[KIT_FIELD[slot]];
    if (valid(id)) out[slot] = id;
    else if (slot === "tom2" && valid(kit.tom1_id)) out.tom2 = kit.tom1_id;
    else if (slot === "rimshot") out.rimshot = "synth";
  }
  return out;
}

/** O kit que corresponde às escolhas atuais (todas as peças definidas pelo kit batem). */
function matchingKit(samples: Record<DrumSlot, string>, kits: DrumKit[]): DrumKit | undefined {
  return kits.find((k) => {
    const fields = ALL_SLOTS.filter((s) => k[KIT_FIELD[s]]);
    return fields.length > 0 && fields.every((s) => k[KIT_FIELD[s]] === samples[s]);
  });
}

/** Valores do preset (drum_studio), com os samples resolvidos pela biblioteca e pelos kits. */
export function drumDefaults(params: Record<string, unknown>, library: DrumLibraryItem[], kits: DrumKit[] = []): DrumTweaks {
  const style = typeof params.kit === "string" ? params.kit : "poprock";
  let samples = {} as Record<DrumSlot, string>;
  for (const slot of ALL_SLOTS) samples[slot] = resolveSample(slot, String(params[SLOT_PARAM[slot]] ?? ""), style, library);
  // preset sem samples definidos: começa pelo kit grátis do estilo (ou o primeiro grátis)
  const explicit = ALL_SLOTS.some((s) => params[SLOT_PARAM[s]]);
  if (!explicit) {
    const free = kits.filter((k) => k.price_credits <= 0);
    const kit = free.find((k) => k.styles.includes(style)) ?? free[0];
    if (kit) samples = kitSamples(kit, library, samples);
  }
  return {
    samples,
    kick: numOf(params.kick, 0),
    snare: numOf(params.snare, 0),
    toms: numOf(params.toms, 0),
    floor: numOf(params.floor, 0),
    kick_tune: numOf(params.kick_tune, 0),
    snare_tune: numOf(params.snare_tune, 0),
    toms_tune: numOf(params.toms_tune, 0),
    floor_tune: numOf(params.floor_tune, 0),
    rimshot: numOf(params.rimshot, 0),
    room: numOf(params.room, 40),
    sample_mix: numOf(params.sample_mix, 60),
    reverb_size: typeof params.reverb_size === "string" ? params.reverb_size : "medium",
    reverb: numOf(params.reverb, 25),
    kick_sens: numOf(params.kick_sens, 50),
    snare_sens: numOf(params.snare_sens, 50),
    tom_sens: numOf(params.tom_sens, 50),
  };
}

const sensLabel = (v: number) => (v === 50 ? "Automático" : v > 50 ? `+${v - 50}` : `${v - 50}`);

const sameTweaks = (a: DrumTweaks, b: DrumTweaks) => JSON.stringify(a) === JSON.stringify(b);
const tuneLabel = (st: number) => (st === 0 ? "original" : `${st > 0 ? "+" : "−"}${String(Math.abs(st) / 2).replace(".", ",")} tom`);

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      <span className="flex justify-between">
        {label}
        <span className="tabular-nums text-text">{display}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-violet-500" />
    </label>
  );
}

const dB = (v: number) => `${v > 0 ? "+" : ""}${v} dB`;

export function DrumPanel({
  media,
  library,
  kits,
  unlocked,
  value,
  defaults,
  onChange,
  loading,
}: {
  media: LoadedMedia;
  library: DrumLibraryItem[] | null;
  kits: DrumKit[];
  /** Kits premium já desbloqueados. */
  unlocked: Set<string>;
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
      const r = analyzeDrums(media.channels, media.sampleRate, { kick: value.kick_sens, snare: value.snare_sens, tom: value.tom_sens });
      if (alive) setCounts(r.counts);
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [media, value.kick_sens, value.snare_sens, value.tom_sens]);

  useEffect(() => () => audio.current?.pause(), []);

  function preview(item: DrumLibraryItem) {
    audio.current?.pause();
    if (playing === item.id) return setPlaying(null);
    const a = new Audio(sampleUrl(item.files[Math.floor((item.files.length - 1) / 2)]));
    audio.current = a;
    a.onended = () => setPlaying(null);
    setPlaying(item.id);
    a.play().catch(() => setPlaying(null));
  }

  const set = (patch: Partial<DrumTweaks>) => onChange({ ...value, ...patch });
  const setSample = (slot: DrumSlot, id: string) => set({ samples: { ...value.samples, [slot]: id } });
  const hasLibrary = Boolean(library?.length);
  const current = matchingKit(value.samples, kits);
  const rimOpts = library ? optionsFor("rimshot", library) : [];
  const rooms = library ? hasRoomMics(value.samples, library) : false;
  const found = counts
    ? [
        counts.kick && `${counts.kick} bumbos`,
        counts.snare && `${counts.snare} caixas`,
        counts.tom1 + counts.tom2 && `${counts.tom1 + counts.tom2} tons`,
        counts.floor && `${counts.floor} no surdo`,
      ].filter(Boolean)
    : null;

  const PlayButton = ({ item }: { item: DrumLibraryItem }) => (
    <button
      type="button"
      onClick={() => preview(item)}
      aria-label={playing === item.id ? "Parar" : `Ouvir ${item.name}`}
      className="grid size-8 shrink-0 place-items-center rounded-full bg-white/8 text-text hover:bg-white/15"
    >
      {playing === item.id ? <Square className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
    </button>
  );

  const selectCls = "h-10 w-full rounded-xl border border-border-strong bg-black/20 px-2 text-sm text-text outline-none focus:border-violet-400";

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

      {kits.length > 0 && library && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted">Kit</span>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Kits de bateria">
            {kits.map((k) => {
              const active = current?.id === k.id;
              const locked = k.price_credits > 0 && !unlocked.has(k.id);
              return (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => set({ samples: kitSamples(k, library, value.samples) })}
                  className={cn(
                    "flex w-44 shrink-0 flex-col gap-1 rounded-2xl border p-3 text-left transition",
                    active ? "border-violet-400 bg-primary/15" : "border-border hover:bg-white/5",
                  )}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                    <span className="truncate">{k.name}</span>
                    {active && <Check className="size-4 shrink-0 text-violet-300" />}
                  </span>
                  {k.description && <span className="line-clamp-2 text-[11px] text-muted">{k.description}</span>}
                  <span
                    className={cn(
                      "mt-auto flex items-center gap-1 self-start rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      k.price_credits <= 0 ? "bg-green-500/15 text-green-300" : locked ? "bg-amber-400/15 text-amber-200" : "bg-violet-500/20 text-violet-100",
                    )}
                  >
                    {k.price_credits <= 0 ? "Grátis" : locked ? <><Lock className="size-3" /> {k.price_credits} créditos</> : "Desbloqueado"}
                  </span>
                </button>
              );
            })}
          </div>
          {kits.some((k) => k.price_credits > 0) && (
            <p className="text-[11px] text-subtle">Kits premium: ouça e teste à vontade; você desbloqueia uma vez só, na hora de baixar.</p>
          )}
        </div>
      )}

      <ul className="grid gap-2 sm:grid-cols-2">
        {SLOTS.map((slot) => {
          const opts = library ? optionsFor(slot, library) : [];
          const chosen = opts.find((o) => o.id === value.samples[slot]);
          const { volume, tune } = CONTROLS[slot];
          const rim = slot === "snare" ? rimOpts.find((o) => o.id === value.samples.rimshot) : undefined;
          return (
            <li key={slot} className="flex flex-col gap-2 rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  {SLOT_LABEL[slot]}
                  {counts && counts[slot] > 0 && <span className="ml-1.5 text-xs font-normal text-subtle">×{counts[slot]}</span>}
                </span>
                {chosen && <PlayButton item={chosen} />}
              </div>
              <select value={value.samples[slot]} onChange={(e) => setSample(slot, e.target.value)} aria-label={`Som do ${SLOT_LABEL[slot]}`} className={selectCls}>
                {opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
                <option value="synth">Sintetizado do estilo</option>
              </select>
              {chosen?.description && <p className="text-[11px] text-subtle">{chosen.description}</p>}
              {volume ? (
                <>
                  <Slider label={slot === "tom1" ? "Volume dos tons" : "Volume"} value={value[volume]} display={dB(value[volume])} min={-12} max={12} step={0.5} onChange={(v) => set({ [volume]: v })} />
                  {tune && (
                    <Slider
                      label={slot === "tom1" ? "Afinação dos tons" : "Afinação"}
                      value={value[tune]}
                      display={tuneLabel(value[tune])}
                      min={-6}
                      max={6}
                      step={0.5}
                      onChange={(v) => set({ [tune]: v })}
                    />
                  )}
                </>
              ) : (
                <p className="text-[11px] text-subtle">Volume e afinação junto com o Tom 1.</p>
              )}
              {slot === "snare" && rimOpts.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border pt-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={value.samples.rimshot}
                      onChange={(e) => setSample("rimshot", e.target.value)}
                      aria-label="Som da caixa com aro"
                      className={selectCls}
                    >
                      <option value="synth">Sem aro (rimshot)</option>
                      {rimOpts.map((o) => (
                        <option key={o.id} value={o.id}>
                          Aro: {o.name}
                        </option>
                      ))}
                    </select>
                    {rim && <PlayButton item={rim} />}
                  </div>
                  {rim && (
                    <Slider
                      label="Caixas mais fortes com aro"
                      value={value.rimshot}
                      display={value.rimshot === 0 ? "nenhuma" : `${value.rimshot}% mais fortes`}
                      min={0}
                      max={100}
                      step={5}
                      onChange={(v) => set({ rimshot: v })}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Sensibilidade da detecção</p>
            <p className="text-[11px] text-muted">
              No meio (Automático) o app calcula pelo seu vídeo. Para a direita pega batidas mais fracas; para a esquerda ignora
              vazamento, sala e metrônomo.
            </p>
          </div>
          {(value.kick_sens !== 50 || value.snare_sens !== 50 || value.tom_sens !== 50) && (
            <button
              type="button"
              onClick={() => set({ kick_sens: 50, snare_sens: 50, tom_sens: 50 })}
              className="flex shrink-0 items-center gap-1 text-xs text-muted hover:text-text"
            >
              <RotateCcw className="size-3.5" /> Automático
            </button>
          )}
        </div>
        {(
          [
            ["kick_sens", "Bumbo"],
            ["snare_sens", "Caixa"],
            ["tom_sens", "Tons e surdo"],
          ] as const
        ).map(([key, label]) => (
          <Slider
            key={key}
            label={label}
            value={value[key]}
            display={sensLabel(value[key])}
            min={0}
            max={100}
            step={5}
            onChange={(v) => set({ [key]: v })}
          />
        ))}
        <p className="text-[11px] text-subtle">
          Metrônomo virando caixa? Baixe a caixa. Faltando batidas fracas (ghost notes)? Suba. Ouça a prévia e veja a contagem acima.
        </p>
      </div>

      <Slider label="Som de estúdio (quanto dos samples entra)" value={value.sample_mix} display={`${value.sample_mix} %`} min={0} max={100} step={5} onChange={(v) => set({ sample_mix: v })} />
      {rooms && (
        <Slider label="Microfones de sala do kit" value={value.room} display={`${value.room} %`} min={0} max={100} step={5} onChange={(v) => set({ room: v })} />
      )}

      <p className="text-xs text-subtle">
        {hasLibrary
          ? "Cada bumbo, caixa, tom e surdo que você tocou dispara o sample escolhido, na mesma força da sua batida. Pratos e chimbal ficam como você gravou."
          : "Ainda não há samples de bateria na biblioteca: por enquanto o app usa timbres sintetizados do estilo. Pratos e chimbal ficam como você gravou."}
      </p>
    </div>
  );
}
