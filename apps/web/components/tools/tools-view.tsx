"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, AudioLines, Crown, Disc3, Download, FileAudio, Gauge, Layers, Mic2, Music2, RefreshCw, X } from "lucide-react";
import { DEFAULT_TOOL_COSTS, DELIVERY_IDS, DELIVERY_TARGETS, parseToolCosts, PRO_FORMATS, toolCredits, type DeliveryId, type ToolCosts, type ToolId } from "@mixpro/contracts";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn, formatDuration } from "@/lib/cn";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fileDuration, runToolJob, toolUpload, ToolError, type ToolResult } from "@/lib/tools/client";
import { reportError } from "@/lib/error-log";
import { track } from "@/lib/track";

type Def = { id: ToolId; icon: typeof Mic2; title: string; text: string; files: { label: string; hint: string }[]; multi?: boolean };

const TOOLS: Def[] = [
  { id: "voice_playback", icon: Mic2, title: "Voz + Playback", text: "Envie a voz e o playback: o Mix Pro alinha, trata a voz, abre espaço na base e entrega a música mixada e masterizada.", files: [{ label: "Sua voz", hint: "a gravação do canto" }, { label: "Playback", hint: "a base instrumental" }] },
  { id: "pitch_tempo", icon: Music2, title: "Tom e andamento", text: "Mude o tom da música para a sua voz ou o andamento para ensaiar, sem perder qualidade. Mostra o BPM e o tom.", files: [{ label: "Música ou playback", hint: "áudio ou vídeo" }] },
  { id: "reference_master", icon: Gauge, title: "Masterização por referência", text: "Envie uma música que você ama: o Mix Pro aproxima o timbre, a densidade e o volume da sua gravação dela.", files: [{ label: "Sua música", hint: "a sua mixagem" }, { label: "Referência", hint: "a música que é o seu alvo" }] },
  { id: "album", icon: Disc3, title: "Modo álbum / EP", text: "Várias faixas com o mesmo volume e timbre consistente entre elas, como num álbum profissional.", files: [{ label: "Faixas", hint: "de 2 a 12 músicas" }], multi: true },
  { id: "stems", icon: Layers, title: "Separar faixas (alta qualidade)", text: "Voz, bateria, baixo e instrumentos em arquivos separados, processados no servidor com IA de estúdio.", files: [{ label: "Música", hint: "até 10 minutos" }] },
  { id: "convert", icon: RefreshCw, title: "Converter formato", text: "WMA, AIFF e outros formatos que o navegador não abre viram WAV ou FLAC. Grátis.", files: [{ label: "Arquivo", hint: "WMA, AIFF, ALAC…" }] },
];

const FORMATS: { id: string; label: string }[] = [
  { id: "mp3", label: "MP3" },
  { id: "wav", label: "WAV" },
  { id: "m4a", label: "M4A" },
  { id: "wav24", label: "WAV 24 bits" },
  { id: "flac", label: "FLAC" },
];

const ACCEPT = "audio/*,video/*,.wma,.aif,.aiff,.flac,.ogg,.m4a,.mp3,.wav,.mp4,.mov";

type Picked = { file: File; duration: number | null };

function Slider({ label, value, min, max, step = 1, onChange, show }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; show: (v: number) => string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-violet-200">{show(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-violet-500" />
    </label>
  );
}

export function ToolsView() {
  const params = useSearchParams();
  const { user, account, requireLogin, showNoCredits, refresh } = useAccountCtx();
  const toast = useToast();
  const [tool, setTool] = useState<ToolId | null>((params.get("ferramenta") as ToolId | null) ?? null);
  const [costs, setCosts] = useState<ToolCosts>(DEFAULT_TOOL_COSTS);
  const [pro, setPro] = useState(false);

  useEffect(() => {
    supabaseBrowser()
      .from("system_settings")
      .select("value")
      .eq("key", "tool_credit_costs")
      .maybeSingle()
      .then(({ data }) => setCosts(parseToolCosts(data?.value)), () => {});
  }, []);
  useEffect(() => {
    if (!user) return;
    void supabaseBrowser()
      .rpc("my_is_pro")
      .then(({ data }) => setPro(data === true), () => {});
  }, [user]);

  const def = TOOLS.find((t) => t.id === tool) ?? null;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {!def ? (
        <>
          <div>
            <h1 className="font-display text-2xl font-semibold md:text-3xl">Ferramentas de estúdio</h1>
            <p className="text-sm text-muted">Processadas no servidor: rápidas no celular e com qualidade de estúdio. Você paga em créditos só quando o resultado fica pronto.</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {TOOLS.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setTool(t.id)} className="glass flex h-full w-full flex-col gap-3 rounded-3xl p-5 text-left transition hover:border-violet-400/50">
                  <span className="flex items-center gap-3">
                    <span className="bg-brand grid size-11 place-items-center rounded-2xl text-white">
                      <t.icon className="size-5" />
                    </span>
                    <span className="font-display text-lg font-semibold">{t.title}</span>
                  </span>
                  <span className="text-sm text-muted">{t.text}</span>
                  <span className="mt-auto text-xs font-semibold text-violet-200">
                    {t.id === "convert" ? "Grátis" : t.id === "album" ? `${costs.album_track} créditos por faixa` : t.id === "stems" ? `${costs.stems} créditos por música` : `${toolCredits(t.id, { durations: [60, 60] }, costs)} créditos`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!pro && (
            <Card className="flex flex-col gap-2 border border-amber-400/30 p-5">
              <p className="flex items-center gap-2 font-semibold">
                <Crown className="size-5 text-amber-300" /> Plano Pro
              </p>
              <p className="text-sm text-muted">250 créditos por mês, Cofre de 30 dias para baixar de novo, WAV 24 bits e FLAC, relatório técnico grátis e prioridade na fila.</p>
              <a href="/creditos" className="text-sm font-semibold text-violet-200 underline">
                Conhecer o Plano Pro
              </a>
            </Card>
          )}
        </>
      ) : (
        <ToolForm key={def.id} def={def} costs={costs} pro={pro} balance={account?.balance ?? null} signedIn={Boolean(user)} onBack={() => setTool(null)} requireLogin={requireLogin} showNoCredits={showNoCredits} refresh={refresh} toast={toast} />
      )}
    </div>
  );
}

function ToolForm(props: {
  def: Def;
  costs: ToolCosts;
  pro: boolean;
  balance: number | null;
  signedIn: boolean;
  onBack: () => void;
  requireLogin: (reason?: string) => Promise<boolean>;
  showNoCredits: () => void;
  refresh: () => Promise<unknown> | void;
  toast: ReturnType<typeof useToast>;
}) {
  const { def, costs, pro, balance, toast } = props;
  const [files, setFiles] = useState<(Picked | null)[]>(def.multi ? [] : def.files.map(() => null));
  const [format, setFormat] = useState(def.id === "convert" ? "flac" : "mp3");
  const [semitones, setSemitones] = useState(0);
  const [tempo, setTempo] = useState(100);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [reverb, setReverb] = useState(25);
  const [autoAlign, setAutoAlign] = useState(true);
  const [offsetMs, setOffsetMs] = useState(0);
  const [amount, setAmount] = useState(def.id === "album" ? 50 : 70);
  const [delivery, setDelivery] = useState<DeliveryId>("social");
  const [phase, setPhase] = useState<{ label: string; progress: number } | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [analysis, setAnalysis] = useState<{ key: string | null; bpm: number | null } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const slot = useRef(0);

  async function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    const picked = await Promise.all([...list].map(async (f) => ({ file: f, duration: await fileDuration(f) })));
    if (def.multi) setFiles((cur) => [...cur, ...picked].slice(0, 12));
    else setFiles((cur) => cur.map((c, i) => (i === slot.current ? picked[0] : c)));
    // tom e BPM no próprio aparelho (grátis), para mostrar antes de mudar
    if (def.id === "pitch_tempo") {
      setAnalysis(null);
      try {
        const [{ loadMedia }, { detectKey, detectBpm }] = await Promise.all([import("@/lib/media/load"), import("@/lib/tools/analysis")]);
        const m = await loadMedia(picked[0].file, () => {});
        setAnalysis({ key: detectKey(m.channels, m.sampleRate)?.label ?? null, bpm: detectBpm(m.channels, m.sampleRate)?.bpm ?? null });
      } catch {
        setAnalysis({ key: null, bpm: null });
      }
    }
  }

  const ready = files.length > 0 && files.every((f) => f !== null) && (!def.multi || files.length >= 2);
  const durations = files.map((f) => f?.duration ?? null);
  const unknownDuration = ready && def.id !== "convert" && durations.some((d) => d === null);
  const tooLong = durations.some((d) => d !== null && d > 600);
  const params = (() => {
    const d = durations.map((v) => Math.min(600, Math.ceil(v ?? 600)));
    switch (def.id) {
      case "pitch_tempo":
        return { semitones, tempo: tempo / 100, format, durations: d };
      case "voice_playback":
        return { offset_s: autoAlign ? null : offsetMs / 1000, voice_level_db: voiceLevel, reverb, delivery, format, durations: d };
      case "reference_master":
        return { amount: amount / 100, format, durations: d };
      case "album":
        return { amount: amount / 100, delivery, format, durations: d };
      case "stems":
        return { format, durations: d };
      case "convert":
        return { format: format === "wav" ? "wav" : "flac", durations: d };
    }
  })();
  const credits = ready ? toolCredits(def.id, params as { durations: number[] }, costs) : null;
  const nothingToChange = def.id === "pitch_tempo" && semitones === 0 && tempo === 100;

  async function run() {
    if (!ready || phase) return;
    if (!props.signedIn && !(await props.requireLogin("Entre na sua conta para usar as ferramentas."))) return;
    if (credits && balance !== null && balance < credits) return props.showNoCredits();
    const c = new AbortController();
    ctrl.current = c;
    setResult(null);
    try {
      setPhase({ label: "Preparando os arquivos…", progress: 0 });
      const blobs = await Promise.all(files.map((f) => toolUpload(f!.file)));
      const r = await runToolJob(def.id, params as Record<string, unknown>, blobs, { signal: c.signal, onPhase: (label, progress) => setPhase({ label, progress }) });
      setResult(r);
      track("tool_done", { tool: def.id, credits: r.credits });
      await props.refresh();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") toast.info("Cancelado. Nenhum crédito foi usado.");
      else if (e instanceof ToolError) {
        if (e.code === "INSUFFICIENT_CREDITS") props.showNoCredits();
        else toast.error(e.message);
        reportError("ferramenta", e, { severity: "aviso", context: { ferramenta: def.id, codigo: e.code } });
      } else {
        reportError("ferramenta", e, { context: { ferramenta: def.id } });
        toast.error("Não conseguimos processar agora. Tente de novo em alguns minutos.");
      }
    } finally {
      setPhase(null);
      ctrl.current = null;
    }
  }

  /** URL nova a cada download (as assinadas valem 5 min). */
  const download = useCallback(
    async (i: number) => {
      if (!result) return;
      try {
        const res = await fetch(`/api/tools/jobs/${result.jobId}`, { cache: "no-store" });
        const body = (await res.json()) as { outputs?: { url: string }[] };
        const url = body.outputs?.[i]?.url;
        if (!url) throw new Error();
        window.location.assign(url);
      } catch {
        toast.error("O arquivo não está mais disponível. Processe de novo.");
      }
    },
    [result, toast],
  );

  const m = result?.measures ?? null;
  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={props.onBack} className="flex items-center gap-1 self-start text-sm text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Todas as ferramentas
      </button>
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold">
          <def.icon className="size-6 text-violet-300" /> {def.title}
        </h1>
        <p className="text-sm text-muted">{def.text}</p>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <input ref={inputRef} type="file" accept={ACCEPT} multiple={def.multi} className="hidden" onChange={(e) => void pickFiles(e.target.files).finally(() => (e.target.value = ""))} />
        {def.multi ? (
          <div className="flex flex-col gap-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-border p-3 text-sm">
                <FileAudio className="size-4 text-violet-300" />
                <span className="min-w-0 flex-1 truncate">
                  {String(i + 1).padStart(2, "0")} · {f!.file.name}
                </span>
                <span className="text-xs text-muted">{f!.duration ? formatDuration(f!.duration) : "—"}</span>
                <button type="button" aria-label="Remover" onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))}>
                  <X className="size-4 text-muted" />
                </button>
              </div>
            ))}
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={files.length >= 12}>
              <AudioLines className="size-4" /> Adicionar faixas ({files.length}/12)
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {def.files.map((slotDef, i) => (
              <button
                key={slotDef.label}
                type="button"
                onClick={() => {
                  slot.current = i;
                  inputRef.current?.click();
                }}
                className={cn("flex flex-col items-start gap-1 rounded-2xl border-2 border-dashed p-4 text-left transition", files[i] ? "border-violet-400/60 bg-primary/10" : "border-border-strong hover:border-violet-400/50")}
              >
                <span className="text-sm font-semibold">{slotDef.label}</span>
                <span className="w-full truncate text-xs text-muted">{files[i] ? `${files[i]!.file.name} · ${files[i]!.duration ? formatDuration(files[i]!.duration!) : "duração desconhecida"}` : `Escolher arquivo (${slotDef.hint})`}</span>
              </button>
            ))}
          </div>
        )}

        {def.id === "pitch_tempo" && (
          <>
            {analysis && (
              <p className="rounded-2xl bg-white/5 p-3 text-sm">
                {analysis.key ? (
                  <>
                    Tom detectado: <strong>{analysis.key}</strong>
                  </>
                ) : (
                  "Tom não identificado"
                )}
                {analysis.bpm ? (
                  <>
                    {" "}
                    · <strong>{analysis.bpm} BPM</strong>
                    {tempo !== 100 && <> → {Math.round(analysis.bpm * tempo) / 100} BPM</>}
                  </>
                ) : null}
              </p>
            )}
            <Slider label="Tom" value={semitones} min={-12} max={12} onChange={setSemitones} show={(v) => (v === 0 ? "original" : `${v > 0 ? "+" : ""}${v} semitom${Math.abs(v) > 1 ? "s" : ""}`)} />
            <Slider label="Andamento" value={tempo} min={50} max={150} onChange={setTempo} show={(v) => `${v}%`} />
          </>
        )}
        {def.id === "voice_playback" && (
          <>
            <Slider label="Voz na mix" value={voiceLevel} min={-6} max={6} step={0.5} onChange={setVoiceLevel} show={(v) => (v === 0 ? "padrão de estúdio" : `${v > 0 ? "+" : ""}${v} dB`)} />
            <Slider label="Reverb na voz" value={reverb} min={0} max={100} onChange={setReverb} show={(v) => `${v}%`} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoAlign} onChange={(e) => setAutoAlign(e.target.checked)} className="size-4 accent-violet-500" />
              Alinhar a voz com o playback automaticamente
            </label>
            {!autoAlign && <Slider label="Atraso da voz" value={offsetMs} min={-2000} max={2000} step={10} onChange={setOffsetMs} show={(v) => `${v > 0 ? "+" : ""}${v} ms`} />}
          </>
        )}
        {(def.id === "reference_master" || def.id === "album") && (
          <Slider label={def.id === "album" ? "Igualar o timbre entre as faixas" : "Intensidade"} value={amount} min={0} max={100} step={5} onChange={setAmount} show={(v) => `${v}%`} />
        )}
        {(def.id === "voice_playback" || def.id === "album") && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DELIVERY_IDS.map((id) => (
              <button key={id} type="button" aria-pressed={delivery === id} onClick={() => setDelivery(id)} className={cn("rounded-2xl border p-2 text-left text-xs", delivery === id ? "border-violet-400 bg-primary/12" : "border-border")}>
                <span className="block font-semibold">{DELIVERY_TARGETS[id].label}</span>
                <span className="text-muted">{DELIVERY_TARGETS[id].targetLufs} LUFS</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {FORMATS.filter((f) => (def.id === "convert" ? f.id === "wav" || f.id === "flac" : true)).map((f) => {
            const locked = def.id !== "convert" && PRO_FORMATS.includes(f.id) && !pro;
            return (
              <button
                key={f.id}
                type="button"
                disabled={locked}
                aria-pressed={format === f.id}
                onClick={() => setFormat(f.id)}
                className={cn("flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs", format === f.id ? "border-violet-400 bg-primary/15" : "border-border", locked && "opacity-50")}
                title={locked ? "Plano Pro" : undefined}
              >
                {locked && <Crown className="size-3 text-amber-300" />} {f.label}
              </button>
            );
          })}
        </div>

        {phase ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-white/5 p-4" aria-live="polite">
            <p className="text-sm">{phase.label}</p>
            <ProgressBar value={phase.progress} label={phase.label} />
            <p className="text-xs text-subtle">Pode deixar esta tela aberta. Se sair, o resultado fica em Meus projetos.</p>
            <Button variant="secondary" size="sm" className="self-start" onClick={() => ctrl.current?.abort()}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tooLong && <p className="text-xs text-amber-200">Cada arquivo pode ter no máximo 10 minutos.</p>}
            {unknownDuration && <p className="text-xs text-amber-200">Não conseguimos ler a duração de um arquivo. Converta-o primeiro na ferramenta Converter formato.</p>}
            <Button size="lg" onClick={() => void run()} disabled={!ready || tooLong || unknownDuration || nothingToChange}>
              {def.id === "convert" ? "Converter" : "Processar"}
              {credits !== null && credits > 0 && ` · ${credits} crédito${credits > 1 ? "s" : ""}`}
            </Button>
            <p className="text-center text-xs text-subtle">
              {credits ? `Cobrado só quando o resultado fica pronto${balance !== null ? ` · você tem ${balance} créditos` : ""}.` : "Grátis."} {pro ? "Arquivos no Cofre por 30 dias." : "Arquivos disponíveis por 24 horas."}
            </p>
          </div>
        )}
      </Card>

      {result && (
        <Card className="flex flex-col gap-3 border border-success/30 p-5">
          <p className="font-semibold text-green-300">Pronto!</p>
          {m && (
            <ul className="grid gap-1 text-sm text-muted sm:grid-cols-2">
              {m.tom_antes != null && (
                <li>
                  Tom: {String(m.tom_antes)} → <strong className="text-text">{String(m.tom_depois)}</strong>
                </li>
              )}
              {m.bpm_antes != null && (
                <li>
                  Andamento: {String(m.bpm_antes)} → <strong className="text-text">{String(m.bpm_depois)} BPM</strong>
                </li>
              )}
              {typeof m.lufs === "number" && <li>Loudness: {m.lufs.toFixed(1)} LUFS</li>}
              {typeof m.alvo_lufs === "number" && <li>Alvo da referência: {m.alvo_lufs.toFixed(1)} LUFS</li>}
              {Array.isArray(m.faixas_lufs) && <li>Faixas: {(m.faixas_lufs as number[]).map((v) => v.toFixed(1)).join(" · ")} LUFS</li>}
            </ul>
          )}
          <div className="flex flex-col gap-2">
            {result.outputs.map((o, i) => (
              <Button key={o.name} variant={o.name.endsWith(".zip") ? "primary" : "secondary"} onClick={() => void download(i)}>
                <Download className="size-4" /> {o.name.endsWith(".zip") ? "Baixar tudo (ZIP)" : o.name}
              </Button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
