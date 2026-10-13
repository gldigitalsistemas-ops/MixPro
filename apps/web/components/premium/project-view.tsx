"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AudioLines, Download, FileArchive, Headphones, Loader2, Mic2, RotateCcw, Sliders, Sparkles, UserRound, Wand2 } from "lucide-react";
import type { MixTrack, PremiumId } from "@mixpro/contracts";
import { useAccountCtx } from "@/components/account/account-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { fileDuration } from "@/lib/tools/client";
import { cn, formatDateTime } from "@/lib/cn";
import { supabaseBrowser } from "@/lib/supabase/client";
import { createProject, projectState, revise, startPreview, type JobView, type ProjectState } from "@/lib/premium/client";
import { BeforeAfterPlayer } from "@/app/ouvir/[token]/player";
import { CheckoutDialog, PriceTag, useQuote } from "./checkout";
import { DevBadge } from "./explainer";
import { GENRE_LABEL, ShowcaseConsent } from "./showcase";
import { DEFAULT_CTL, StemsPlayer, type TrackCtl } from "./stems-player";
import { VoiceRecorder } from "./voice-recorder";
import { SupportLink } from "@/components/support/support-link";

export const PRODUCT_NAME: Record<string, string> = {
  vs_premium: "VS Premium 7 faixas",
  mix_ia: "Mix & Master IA",
  producao: "Produção da composição",
  voz_final: "Voz finalizada",
};

export const ROLE_PT: Record<string, string> = {
  lead_vocal: "Voz principal",
  backing_vocal: "Backing vocal",
  kick: "Bumbo",
  snare: "Caixa",
  hihat: "Chimbal",
  toms: "Tons",
  overheads: "Overhead",
  room: "Ambiente",
  drums: "Bateria",
  percussion: "Percussão",
  bass: "Baixo",
  electric_guitar: "Guitarra",
  acoustic_guitar: "Violão",
  piano: "Piano",
  keys: "Teclado",
  synth: "Synth",
  pad: "Pad",
  strings: "Cordas",
  brass: "Metais",
  fx: "Efeitos",
  loop: "Loop",
  playback: "Base/playback",
  other: "Outro",
};

/** Loudness de entrega padrão por estilo (LUFS). */
export const GENRE_LUFS: Record<string, number> = { pop: -10, pop_us: -9, worship: -11, gospel: -10, sertanejo: -9, pagode: -10, funk: -8, rock: -9, trap: -9, acoustic: -13, edm: -8, lofi: -14, mpb: -12 };

function stageText(product: string, pct: number): string {
  const steps: Record<string, [number, string][]> = {
    vs_premium: [
      [15, "Enviando a música para a separação de estúdio…"],
      [60, "Separando voz, bateria, baixo, guitarra, violão e teclado…"],
      [90, "Montando as 7 faixas (e o 'outros' com efeitos e loops)…"],
      [101, "Gravando os arquivos…"],
    ],
    mix_ia: [
      [15, "Lendo as pistas…"],
      [30, "Analisando a sua referência…"],
      [50, "Alinhando fase e tempo, limpando ruídos e afinando a voz…"],
      [80, "Equalizando, comprimindo e equilibrando cada instrumento…"],
      [90, "Masterizando…"],
      [101, "Gravando os arquivos…"],
    ],
    producao: [
      [20, "Analisando tom, andamento, acordes e a melodia da guia…"],
      [70, "Criando as versões da base no estilo pedido…"],
      [85, "Conferindo andamento e harmonia de cada versão…"],
      [101, "Gravando as versões, a folha de cifra e o clique…"],
    ],
    voz_final: [
      [15, "Alinhando a sua voz com a base…"],
      [35, "Analisando a referência…"],
      [85, "Afinando, tratando e mixando a voz…"],
      [101, "Masterizando…"],
    ],
  };
  return (steps[product] ?? [[101, "Processando…"]]).find(([lim]) => pct < lim)?.[1] ?? "Processando…";
}

const hidden = (n: string) => /^(play-|mixer-|vitrine-)/.test(n);
const sizeOf = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`);

function Progress({ job, product, label, onRetry }: { job: JobView; product: string; label: string; onRetry?: () => Promise<void> }) {
  // sem avanço há alguns minutos: avisa que está demorando e oferece ajuda (a pessoa não fica no escuro)
  const last = useRef({ p: job.progress, status: job.status, t: 0 });
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!last.current.t) last.current.t = Date.now();
    const id = setInterval(() => {
      if (job.progress !== last.current.p || job.status !== last.current.status) last.current = { p: job.progress, status: job.status, t: Date.now() };
      setSlow(Date.now() - last.current.t > 6 * 60_000);
    }, 20_000);
    return () => clearInterval(id);
  }, [job.progress, job.status]);
  if (job.status === "failed")
    return (
      <Card className="border-rose-400/40 p-4 text-sm">
        <p className="font-semibold">{label}: não concluída</p>
        <p className="text-muted">{job.message ?? "Algo deu errado. Nada foi cobrado por esta etapa."}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {onRetry && (
            <Button
              size="sm"
              loading={retrying}
              onClick={async () => {
                setRetrying(true);
                try {
                  await onRetry();
                } finally {
                  setRetrying(false);
                }
              }}
            >
              <RotateCcw className="size-4" aria-hidden /> Tentar de novo
            </Button>
          )}
          <SupportLink subject={`${label} não concluída (${product})`}>Chamar no WhatsApp: a gente resolve</SupportLink>
        </div>
      </Card>
    );
  if (job.status === "done") return null;
  return (
    <Card className="flex flex-col gap-3 p-4" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
      </p>
      <ProgressBar value={job.progress} label={stageText(product, job.progress)} />
      <p className="text-sm text-muted">{job.status === "queued" ? "Na fila: começa em instantes." : stageText(product, job.progress)}</p>
      {slow ? (
        <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-100">
          Está demorando mais do que o normal. Pode continuar esperando (nada é cobrado se não terminar), ou{" "}
          <SupportLink subject={`${label} demorando (${product})`} className="text-xs">
            chamar no WhatsApp
          </SupportLink>
          .
        </p>
      ) : (
        <p className="text-xs text-subtle">Pode sair desta tela: avisamos em Meus projetos quando ficar pronto.</p>
      )}
    </Card>
  );
}

function Downloads({ job }: { job: JobView }) {
  const files = job.outputs.filter((o) => !hidden(o.name)).sort((a, b) => Number(b.name.endsWith(".zip")) - Number(a.name.endsWith(".zip")));
  if (!files.length) return null;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <p className="text-sm font-semibold">Seus arquivos</p>
      <div className="flex flex-wrap gap-2">
        {files.map((o) => (
          <a key={o.name} href={o.url} className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm", o.name.endsWith(".zip") ? "bg-brand text-white" : "border border-border-strong hover:bg-white/5")}>
            {o.name.endsWith(".zip") ? <FileArchive className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
            {o.name.endsWith(".zip") ? "Baixar tudo" : o.name} <span className="text-xs opacity-70">{sizeOf(o.bytes)}</span>
          </a>
        ))}
      </div>
      <p className="text-xs text-subtle">Os links valem 10 minutos (recarregue a página para gerar novos). Os arquivos ficam guardados por 30 dias.</p>
    </Card>
  );
}

function Clips({ job, labels = ["Antes", "Depois"] }: { job: JobView; labels?: [string, string] }) {
  const before = job.outputs.find((o) => o.name === "vitrine-antes.m4a");
  const after = job.outputs.find((o) => o.name === "vitrine-depois.m4a");
  if (!before || !after) return null;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <p className="text-sm font-semibold">
        {labels[0]} × {labels[1]} (mesmo trecho, mesmo volume)
      </p>
      <BeforeAfterPlayer before={before.url} after={after.url} lufsBefore={null} lufsAfter={null} />
    </Card>
  );
}

type Decision = { name: string; role: string; gain_db: number; pan: number; hpf_hz: number; comp_ratio: number; tune_cents: number; delay_ms: number; polarity_flipped: boolean; notches_hz: number[]; gate: boolean; silent: boolean };

function WhatWasDone({ product, m }: { product: string; m: Record<string, unknown> | null }) {
  if (!m) return null;
  if (product === "mix_ia" || product === "voz_final") {
    const d = (m.decisoes ?? []) as Decision[];
    const r = (m.relatorio ?? {}) as { lufs?: number; automacao_voz_db?: { avg: number; max: number } };
    return (
      <Card className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Wand2 className="size-4 text-violet-300" aria-hidden /> O que foi feito
        </p>
        <p className="text-xs text-muted">
          Volume final {r.lufs ?? "—"} LUFS{m.tom ? ` · tom ${m.tom}` : ""}
          {r.automacao_voz_db ? ` · automação da voz: média ${r.automacao_voz_db.avg} dB, máx. ${r.automacao_voz_db.max} dB` : ""}
          {m.referencia_separada ? " · referência separada e usada por grupo" : ""}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-left text-subtle">
              <tr>
                <th className="py-1 font-normal">Pista</th>
                <th className="font-normal">Papel</th>
                <th className="font-normal">Volume</th>
                <th className="font-normal">Pan</th>
                <th className="font-normal">Filtro</th>
                <th className="font-normal">Compressão</th>
                <th className="font-normal">Afinação</th>
                <th className="font-normal">Fase</th>
                <th className="font-normal">Ressonâncias</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {d.map((x) => (
                <tr key={x.name} className={x.silent ? "opacity-40" : ""}>
                  <td className="py-1.5">{x.name}</td>
                  <td>{ROLE_PT[x.role] ?? x.role}</td>
                  <td className="font-mono">{x.silent ? "mudo" : `${x.gain_db > 0 ? "+" : ""}${x.gain_db} dB`}</td>
                  <td className="font-mono">{x.pan === 0 ? "C" : x.pan < 0 ? `E${Math.round(-x.pan * 100)}` : `D${Math.round(x.pan * 100)}`}</td>
                  <td className="font-mono">{x.hpf_hz} Hz</td>
                  <td className="font-mono">{x.comp_ratio > 1 ? `${x.comp_ratio}:1` : "—"}</td>
                  <td className="font-mono">{x.tune_cents ? `${x.tune_cents} ¢` : "—"}</td>
                  <td>{x.delay_ms || x.polarity_flipped ? `${x.delay_ms} ms${x.polarity_flipped ? ", invertida" : ""}` : "—"}</td>
                  <td className="font-mono">{x.notches_hz.length ? x.notches_hz.map((f) => `${f}`).join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }
  if (product === "producao") {
    const v = (m.versoes ?? []) as { nota: number; bpm: number; harmonia: number }[];
    return (
      <Card className="flex flex-col gap-2 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <Wand2 className="size-4 text-violet-300" aria-hidden /> O que a IA entendeu da sua guia
        </p>
        <p className="text-muted">
          Andamento {String(m.bpm ?? "—")} BPM · Tom {String(m.tom ?? "—")}
        </p>
        {Array.isArray(m.acordes_guia) && <p className="text-muted">Acordes: {(m.acordes_guia as string[]).slice(0, 16).join(" → ")}</p>}
        {v.length > 0 && <p className="text-xs text-subtle">Cada versão passou pela conferência de andamento e harmonia (nota {v.map((x) => x.nota).join(", ")} de 100).</p>}
      </Card>
    );
  }
  return null;
}

/** Mixer da Mix & Master IA: ouve as pistas tratadas, ajusta e manda mixar de novo. */
function MixEditor({ state, job, onDone }: { state: ProjectState; job: JobView; onDone: () => void }) {
  const toast = useToast();
  const params = state.project.params as { tracks?: MixTrack[] };
  const tracks = useMemo(() => params.tracks ?? [], [params.tracks]);
  const decisions = ((job.measures?.decisoes ?? []) as Decision[]) ?? [];
  const stems = job.outputs.filter((o) => /^mixer-\d\d\.m4a$/.test(o.name)).sort((a, b) => a.name.localeCompare(b.name));
  const [ctl, setCtl] = useState<Record<string, TrackCtl>>({});
  const [edit, setEdit] = useState<Record<number, Partial<MixTrack>>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!stems.length || !tracks.length) return null;

  async function remix() {
    const next = tracks.map((t, i) => {
      const c = ctl[String(i)] ?? DEFAULT_CTL;
      const e = edit[i] ?? {};
      const basePan = decisions[i]?.pan ?? 0;
      return {
        ...t,
        ...e,
        gain_db: Math.max(-24, Math.min(12, (e.gain_db ?? t.gain_db) + c.volumeDb)),
        pan: c.pan !== 0 ? Math.max(-1, Math.min(1, Math.round((basePan + c.pan) * 100) / 100)) : (e.pan ?? t.pan),
        mute: c.mute,
      };
    });
    setBusy(true);
    try {
      const p = { ...state.project.params, tracks: next };
      if (state.paid) await revise(state.project.id, p);
      else await startPreview(state.project.id, p);
      toast.success(state.paid ? "Mixando de novo com os seus ajustes." : "Fazendo uma prévia nova com os seus ajustes.");
      setCtl({});
      setEdit({});
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Sliders className="size-4 text-violet-300" aria-hidden /> Mixer: ouça cada pista e ajuste do seu jeito
      </p>
      <p className="text-xs text-muted">Volume, pan, mudo e solo mudam na hora. Em “Ajustes da pista” você muda equalização, compressão, reverb e afinação. Depois é só mixar de novo.</p>
      <StemsPlayer
        tracks={stems.map((s, i) => ({ id: String(i), label: tracks[i]?.name.replace(/\.[^.]+$/, "") ?? s.name, url: s.url }))}
        ctl={ctl}
        onCtl={(id, c) => setCtl((x) => ({ ...x, [id]: c }))}
      />
      <div className="flex flex-col gap-1">
        {tracks.map((t, i) => {
          const e = { ...t, ...(edit[i] ?? {}) };
          const set = (patch: Partial<MixTrack>) => setEdit((x) => ({ ...x, [i]: { ...(x[i] ?? {}), ...patch } }));
          const slider = (label: string, key: "eq_low" | "eq_mid" | "eq_high", min = -12, max = 12) => (
            <label className="flex items-center gap-2 text-xs text-muted">
              <span className="w-24">{label}</span>
              <input type="range" min={min} max={max} step={0.5} value={e[key]} onChange={(ev) => set({ [key]: Number(ev.target.value) })} className="flex-1 accent-violet-500" />
              <span className="w-12 text-right font-mono">{e[key] > 0 ? "+" : ""}{e[key]}</span>
            </label>
          );
          return (
            <div key={t.name} className="rounded-xl border border-border">
              <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm">
                <span>
                  Ajustes da pista: <strong>{t.name}</strong> <span className="text-xs text-muted">({ROLE_PT[t.role]})</span>
                </span>
                <span className="text-xs text-violet-200">{open === i ? "fechar" : "abrir"}</span>
              </button>
              {open === i && (
                <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
                  {slider("Graves", "eq_low")}
                  {slider("Médios", "eq_mid")}
                  {slider("Agudos", "eq_high")}
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <span className="w-24">Compressão</span>
                    <input type="range" min={0} max={100} value={e.comp ?? 50} onChange={(ev) => set({ comp: Number(ev.target.value) })} className="flex-1 accent-violet-500" />
                    <span className="w-12 text-right font-mono">{e.comp ?? "auto"}</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <span className="w-24">Reverb</span>
                    <input type="range" min={0} max={100} value={e.reverb ?? 30} onChange={(ev) => set({ reverb: Number(ev.target.value) })} className="flex-1 accent-violet-500" />
                    <span className="w-12 text-right font-mono">{e.reverb ?? "auto"}</span>
                  </label>
                  {(t.role === "lead_vocal" || t.role === "backing_vocal") && (
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <span className="w-24">Afinação</span>
                      <input type="range" min={0} max={100} value={e.tune} onChange={(ev) => set({ tune: Number(ev.target.value) })} className="flex-1 accent-violet-500" />
                      <span className="w-12 text-right font-mono">{e.tune}%</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button className="self-start" onClick={() => void remix()} loading={busy}>
        <RotateCcw className="size-4" aria-hidden /> {state.paid ? "Mixar de novo com meus ajustes" : "Nova prévia com meus ajustes"}
      </Button>
    </Card>
  );
}

/** Produção: escolher a base e seguir para a voz finalizada (gravar ou enviar). */
function ComposeNext({ state, job }: { state: ProjectState; job: JobView }) {
  const toast = useToast();
  const router = useRouter();
  const versions = job.outputs.filter((o) => /^versao-\d\.(wav|mp3|m4a|flac)$/.test(o.name)).sort((a, b) => a.name.localeCompare(b.name));
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(0);
  if (!versions.length) return null;

  async function withVoice(vocal: File) {
    const base = versions[pick!];
    setBusy(0.01);
    try {
      const blob = await (await fetch(base.url)).blob();
      const [dv, db] = await Promise.all([fileDuration(vocal), fileDuration(blob)]);
      if (!dv || !db) throw new Error("Não conseguimos ler a gravação. Envie em WAV, MP3 ou M4A.");
      const id = await createProject("voz_final", [{ file: vocal, name: vocal.name }, { file: blob, name: base.name }], setBusy, { parentId: state.project.id, title: state.project.title });
      const genre = String(state.project.params.genre ?? "pop");
      await startPreview(id, {
        format: "wav",
        durations: [Math.ceil(dv * 100) / 100, Math.ceil(db * 100) / 100],
        has_reference: false,
        ref_amount: 0.6,
        genre,
        tune: 50,
        melody: (job.measures?.melodia as [number, number, number][] | undefined) ?? null,
        vocal_level_db: 0,
        reverb: 30,
        master_chain: null,
        master_name: null,
        target_lufs: GENRE_LUFS[genre] ?? -11,
      });
      router.push(`/premium/${id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(0);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Mic2 className="size-4 text-violet-300" aria-hidden /> Próximo passo: grave a sua voz na base escolhida
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        {versions.map((v, i) => (
          <button key={v.name} type="button" onClick={() => setPick(i)} className={cn("flex flex-col gap-2 rounded-2xl border p-3 text-left", pick === i ? "border-violet-400 bg-primary/10" : "border-border")}>
            <span className="text-sm font-semibold">Versão {i + 1}</span>
            <audio controls preload="none" src={v.url} className="w-full" onClick={(e) => e.stopPropagation()} />
          </button>
        ))}
      </div>
      {pick !== null &&
        (busy ? (
          <ProgressBar value={busy * 100} label="Enviando a voz e a base" />
        ) : (
          <VoiceRecorder baseUrl={versions[pick].url} onReady={(f) => void withVoice(f)} />
        ))}
    </Card>
  );
}

export function ProjectView({ id }: { id: string }) {
  const params = useSearchParams();
  const toast = useToast();
  const { user, requireLogin } = useAccountCtx();
  const [state, setState] = useState<ProjectState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pay, setPay] = useState<PremiumId | null>(null);
  const [reward, setReward] = useState(10);
  const [showcaseItem, setShowcaseItem] = useState<{ id: string; status: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await projectState(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    if (!user) {
      void requireLogin("Entre para ver o seu projeto.");
      return;
    }
    // chamada de rede; o estado muda quando ela responde
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void supabaseBrowser()
      .from("system_settings")
      .select("value")
      .eq("key", "showcase_reward_credits")
      .maybeSingle()
      .then(({ data }) => Number.isFinite(Number(data?.value)) && setReward(Number(data?.value)));
    void supabaseBrowser()
      .from("showcase_items")
      .select("id,status")
      .eq("project_id", id)
      .neq("status", "revoked")
      .maybeSingle()
      .then(({ data }) => data && setShowcaseItem(data as { id: string; status: string }));
  }, [user, load, requireLogin, id]);

  const running = Boolean(state && [state.preview, state.final].some((j) => j && (j.status === "queued" || j.status === "running")));
  const waitingPayment = params.get("pagamento") === "sucesso" && state && !state.paid;
  useEffect(() => {
    if (!running && !waitingPayment) return;
    const t = setInterval(() => void load(), running ? 3000 : 5000);
    return () => clearInterval(t);
  }, [running, waitingPayment, load]);

  const product = state?.project.product ?? "mix_ia";
  const q = useQuote(product as PremiumId, state?.project.minutes ?? 0, Boolean(state && !state.paid));
  const engQ = useQuote("eng_finaliza", 0, Boolean(state?.paid && product === "mix_ia"));

  if (error) return <p className="text-sm text-muted">{error}</p>;
  if (!state)
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando o projeto…
      </p>
    );

  const { project, preview, final } = state;
  const finalDone = final?.status === "done";
  const show = finalDone ? final : preview?.status === "done" ? preview : null;
  const name = PRODUCT_NAME[project.product];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-violet-300">
            {name} <DevBadge />
          </p>
          <h1 className="font-display text-2xl font-semibold">{project.title || "Projeto"}</h1>
          <p className="text-xs text-muted">
            {project.params.genre ? `${GENRE_LABEL[String(project.params.genre)] ?? project.params.genre} · ` : ""}
            guardado até {formatDateTime(project.expiresAt)}
          </p>
        </div>
        <Badge tone={finalDone ? "success" : state.paid ? "primary" : "info"}>{finalDone ? "Entregue" : state.paid ? "Pago — processando" : preview?.status === "done" ? "Prévia pronta" : "Prévia"}</Badge>
      </div>

      {waitingPayment && (
        <Card className="flex items-center gap-2 p-4 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Confirmando o pagamento com o Mercado Pago…
        </Card>
      )}

      {final && <Progress job={final} product={project.product} label="Trabalho completo" />}
      {!final && preview && (
        <Progress
          job={preview}
          product={project.product}
          label="Prévia grátis (30 s)"
          onRetry={
            state.owner
              ? async () => {
                  try {
                    await startPreview(project.id, project.params);
                    toast.success("Tentando de novo. A prévia já está sendo feita.");
                    await load();
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }
              : undefined
          }
        />
      )}

      {show && (
        <>
          {project.product === "vs_premium" && (
            <Card className="flex flex-col gap-3 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <AudioLines className="size-4 text-violet-300" aria-hidden /> {finalDone ? "As 7 faixas" : "Ouça a prévia das 7 faixas (30 s)"}
              </p>
              <VsPreview job={show} />
              {finalDone && (
                <Link href={`/vs?projeto=${project.id}`} className="bg-brand self-start rounded-full px-5 py-2.5 text-sm font-semibold text-white">
                  Abrir no VS (mixer, clique e exportação)
                </Link>
              )}
            </Card>
          )}
          {project.product === "producao" && !finalDone && (
            <Card className="flex flex-col gap-2 p-4">
              <p className="text-sm font-semibold">Ouça as versões (30 s de cada)</p>
              <div className="grid gap-2 md:grid-cols-3">
                {show.outputs
                  .filter((o) => /^previa-versao-\d\.m4a$/.test(o.name))
                  .map((o, i) => (
                    <div key={o.name} className="flex flex-col gap-1 rounded-2xl border border-border p-3">
                      <span className="text-sm">Versão {i + 1}</span>
                      <audio controls preload="none" src={o.url} className="w-full" />
                    </div>
                  ))}
              </div>
            </Card>
          )}
          {(project.product === "mix_ia" || project.product === "voz_final") && !finalDone && show.outputs.find((o) => o.name.startsWith("previa")) && (
            <Card className="flex flex-col gap-2 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Headphones className="size-4" aria-hidden /> Prévia da mix (30 s, já masterizada)
              </p>
              <audio controls src={show.outputs.find((o) => o.name.startsWith("previa"))!.url} className="w-full" />
            </Card>
          )}
          <Clips job={show} labels={project.product === "vs_premium" ? ["Música", "Sem a voz"] : project.product === "producao" ? ["Sua guia", "Versão 1"] : ["Antes", "Depois"]} />
          {project.product === "mix_ia" && state.owner && <MixEditor state={state} job={show} onDone={() => void load()} />}
          <WhatWasDone product={project.product} m={show.measures} />
        </>
      )}

      {!state.paid && preview?.status === "done" && state.owner && (
        <Card className="flex flex-col gap-3 border-violet-400/40 p-5">
          <p className="font-display text-lg font-semibold">Gostou? Libere o trabalho completo</p>
          <PriceTag q={q} />
          <p className="text-sm text-muted">{whatYouGet(project.product)}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => setPay(project.product as PremiumId)}>
              Finalizar {name}
            </Button>
            {project.product === "producao" && (
              <Button size="lg" variant="secondary" onClick={() => setPay("pacote_compositor")}>
                Pacote compositor (produção + voz finalizada)
              </Button>
            )}
          </div>
        </Card>
      )}

      {finalDone && final && (
        <>
          <Downloads job={final} />
          {project.product === "producao" && state.owner && <ComposeNext state={state} job={final} />}
          {project.product === "mix_ia" && state.owner && (
            <Card className="flex flex-col gap-2 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <UserRound className="size-4 text-violet-300" aria-hidden /> Quer o toque final de um engenheiro?
              </p>
              <p className="text-muted">Um engenheiro de áudio parte desta mix, faz os ajustes finos e conversa com você pelo pedido (com revisões).</p>
              <PriceTag q={engQ} compact />
              <Button size="sm" variant="secondary" className="self-start" onClick={() => setPay("eng_finaliza")}>
                Pedir o engenheiro
              </Button>
            </Card>
          )}
          {state.owner && <ShowcaseConsent projectId={project.id} reward={reward} defaultGenre={String(project.params.genre ?? "")} existing={showcaseItem} onChange={() => void load()} />}
        </>
      )}

      {!preview && !final && (
        <Card className="p-4 text-sm text-muted">
          Este projeto ainda não tem prévia. <Link href={project.product === "mix_ia" ? "/mixar" : project.product === "producao" ? "/produzir" : "/vs"} className="text-violet-200 underline">Começar de novo</Link>
        </Card>
      )}

      {pay && (
        <CheckoutDialog
          open
          onClose={() => setPay(null)}
          projectId={project.id}
          product={pay}
          minutes={project.minutes}
          title={pay === "pacote_compositor" ? "Pacote compositor" : pay === "eng_finaliza" ? "Engenheiro finaliza" : name}
          onPaid={() => {
            toast.success("Tudo certo!");
            void load();
          }}
        />
      )}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
        <Sparkles className="size-3.5" aria-hidden /> Recurso em desenvolvimento: se algo não ficar como você esperava, fale com a gente que refazemos.
        <SupportLink subject={`projeto ${project.id.slice(0, 8)} (${name})`} className="text-xs">
          Chamar no WhatsApp (21) 97265-2314
        </SupportLink>
      </p>
    </div>
  );
}

function whatYouGet(product: string): string {
  switch (product) {
    case "vs_premium":
      return "As 7 faixas da música inteira (voz, bateria, baixo, guitarra, violão, teclado e outros) em alta qualidade, prontas para o VS: mixer, clique e exportação.";
    case "mix_ia":
      return "A música inteira mixada e masterizada, a versão pré-master, instrumental, a capella, todas as pistas tratadas e 7 dias de revisões com os seus ajustes.";
    case "producao":
      return "As versões completas da base (WAV ou MP3), a folha de cifra com tom e BPM e o clique para gravar. O Pacote inclui também a voz finalizada.";
    case "voz_final":
      return "Sua voz afinada, tratada, mixada e masterizada na base — pronta para Spotify e todas as plataformas — mais instrumental, voz tratada e 7 dias de revisões.";
  }
  return "";
}

/** Prévia/entrega do VS Premium: as 7 faixas tocando juntas com mudo e solo. */
function VsPreview({ job }: { job: JobView }) {
  const order = ["voz", "bateria", "baixo", "guitarra", "violao", "teclado", "outros"];
  const LABEL: Record<string, string> = { voz: "Voz", bateria: "Bateria", baixo: "Baixo", guitarra: "Guitarra", violao: "Violão", teclado: "Teclado", outros: "Outros" };
  const tracks = order
    .map((k) => ({ k, o: job.outputs.find((x) => x.name === `play-${k}.m4a`) }))
    .filter((x) => x.o)
    .map((x) => ({ id: x.k, label: LABEL[x.k], url: x.o!.url }));
  const [ctl, setCtl] = useState<Record<string, TrackCtl>>({});
  if (!tracks.length) return null;
  return <StemsPlayer tracks={tracks} ctl={ctl} onCtl={(id, c) => setCtl((x) => ({ ...x, [id]: c }))} compact />;
}
