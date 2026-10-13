"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileAudio, Music4, Plus, Trash2, Upload } from "lucide-react";
import { MIX_GENRES, TRACK_ROLES, type MixTrack, type TrackRole } from "@mixpro/contracts";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { guessRole } from "@/lib/mixengine/roles";
import { createProject, startPreview } from "@/lib/premium/client";
import { fetchPresets, type StudioPreset } from "@/lib/presets";
import { freezeChain } from "@/lib/user-presets";
import { fileDuration } from "@/lib/tools/client";
import { formatDuration } from "@/lib/cn";
import { reportError } from "@/lib/error-log";
import { PriceTag, useQuote } from "./checkout";
import { Faq, ModuleExplainer } from "./explainer";
import { GENRE_LUFS, ROLE_PT } from "./project-view";
import { GENRE_LABEL, ShowcaseStrip } from "./showcase";

type Picked = { file: File; duration: number | null; role: TrackRole };

const ACCEPT = ".wav,.aif,.aiff,.flac,.mp3,.m4a,audio/*";

export const MIX_FAQ = [
  { q: "Preciso exportar as pistas de um jeito especial?", a: "Exporte cada instrumento em um arquivo (WAV de preferência), todos começando no mesmo ponto (do compasso 1 até o fim), sem efeitos de master. Pistas mono podem ser mono. Até 24 pistas e 6 minutos." },
  { q: "Para que serve a referência?", a: "É uma música que tem o som que você quer. A IA separa a referência e aproxima o equilíbrio e o timbre de voz, bateria, baixo e instrumentos da sua mix — sem copiar nada da música." },
  { q: "Eu posso mudar o que a IA fez?", a: "Sim. Você ouve cada pista no mixer, muda volume, pan, equalização, compressão, reverb e afinação, e manda mixar de novo — por 7 dias depois do pagamento." },
  { q: "Fica pronto para o Spotify?", a: "Sim: a entrega sai masterizada no volume do estilo escolhido, com teto de −1 dBTP, em WAV/MP3 (e WAV 24 bits/FLAC no Plano Pro), mais a versão pré-master se você quiser masterizar fora." },
  { q: "E se eu não gostar?", a: "Você ouve uma prévia grátis de 30 segundos antes de pagar. Depois de pago, tem revisões; e pode pedir o engenheiro para o toque final." },
];

export function MixWizard() {
  const router = useRouter();
  const toast = useToast();
  const { requireLogin } = useAccountCtx();
  const [tracks, setTracks] = useState<Picked[]>([]);
  const [ref, setRef] = useState<{ file: File; duration: number | null } | null>(null);
  const [genre, setGenre] = useState<string>("worship");
  const [masters, setMasters] = useState<StudioPreset[]>([]);
  const [master, setMaster] = useState<string>("");
  const [align, setAlign] = useState(true);
  const [tune, setTune] = useState(40);
  const [busy, setBusy] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const minutes = Math.max(0, ...tracks.map((t) => t.duration ?? 0)) / 60;
  const q = useQuote("mix_ia", minutes);

  useEffect(() => {
    fetchPresets()
      .then((c) => {
        const ids = new Set(c.categories.filter((x) => x.groupId === "master").map((x) => x.id));
        setMasters(c.presets.filter((p) => ids.has(p.categoryId)));
      })
      .catch(() => {});
  }, []);

  async function add(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files);
    const picked = await Promise.all(list.map(async (file) => ({ file, duration: await fileDuration(file), role: guessRole(file.name) })));
    setTracks((t) => [...t, ...picked].slice(0, 24));
  }

  async function go() {
    if (!(await requireLogin("Entre na sua conta para mixar o seu projeto. A prévia é grátis."))) return;
    if (tracks.length < 2) return toast.error("Envie pelo menos 2 pistas.");
    if (tracks.some((t) => !t.duration)) return toast.error("Alguma pista não pôde ser lida. Use WAV, AIFF, FLAC, MP3 ou M4A.");
    setBusy(0);
    try {
      const files = [...tracks.map((t) => ({ file: t.file, name: t.file.name, role: t.role })), ...(ref ? [{ file: ref.file, name: ref.file.name, role: "referencia" }] : [])];
      const id = await createProject("mix_ia", files, (v) => setBusy(v * 100), { title: tracks[0].file.name.replace(/\.[^.]+$/, "") });
      const m = masters.find((x) => x.id === master) ?? null;
      const chain = m ? freezeChain(m.chain, m.defaultIntensity) : null;
      const target = (chain?.chain.find((s) => s.type === "normalize")?.params?.target_db as number | undefined) ?? GENRE_LUFS[genre] ?? -11;
      const mixTracks: MixTrack[] = tracks.map((t) => ({
        name: t.file.name.replace(/[^A-Za-z0-9 ._()+-]+/g, "-").slice(-60),
        role: t.role,
        gain_db: 0,
        pan: null,
        mute: false,
        eq_low: 0,
        eq_mid: 0,
        eq_high: 0,
        comp: null,
        reverb: null,
        tune: t.role === "lead_vocal" || t.role === "backing_vocal" ? tune : 0,
      }));
      await startPreview(id, {
        format: "wav",
        durations: [...tracks.map((t) => Math.ceil(t.duration! * 100) / 100), ...(ref ? [Math.ceil((ref.duration ?? 600) * 100) / 100] : [])],
        has_reference: Boolean(ref),
        ref_amount: 0.7,
        genre,
        align,
        tracks: mixTracks,
        master_chain: chain,
        master_name: m?.name ?? null,
        target_lufs: Math.max(-20, Math.min(-6, target)),
      });
      router.push(`/premium/${id}`);
    } catch (e) {
      reportError("mix-ia", e, { severity: "aviso" });
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <ModuleExplainer
        title="Mix & Master IA"
        tagline="Envie as pistas do seu projeto (voz, bateria, baixo, guitarras, violões, teclados, efeitos…) e receba a música mixada e masterizada, pronta para o Spotify — com um mixer para você ajustar o que quiser."
        forWho="Para quem gravou a música por pistas (no estúdio, em casa ou no celular) e quer o som de uma produção profissional sem pagar um estúdio."
        send={["Cada instrumento em um arquivo (WAV, AIFF, FLAC, MP3 ou M4A), começando no mesmo ponto", "Até 24 pistas e 6 minutos", "Opcional: uma música de referência com o som que você quer"]}
        receive={["Música mixada e masterizada (WAV/MP3; WAV 24/FLAC no Pro)", "Versão pré-master, instrumental e a capella", "Todas as pistas tratadas (para usar onde quiser)", "Mixer no app e 7 dias de revisões", "O que foi feito em cada pista"]}
        time="A prévia sai em 1 a 3 minutos. A mix completa leva de 3 a 15 minutos, conforme o número de pistas."
        steps={[
          { title: "Envie as pistas", text: "O app reconhece cada instrumento pelo nome do arquivo; você confere." },
          { title: "Escolha o som", text: "Estilo, master (Pop americano, Worship, Sertanejo…) e uma referência, se quiser." },
          { title: "Ouça a prévia grátis", text: "30 segundos já mixados e masterizados, com antes e depois." },
          { title: "Finalize e ajuste", text: "Pague, baixe tudo e ajuste no mixer por 7 dias." },
        ]}
        faq={MIX_FAQ}
      />

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <FileAudio className="size-5 text-violet-300" aria-hidden /> 1. Suas pistas ({tracks.length}/24)
          </h2>
          <PriceTag q={q} compact />
        </div>
        <p className="text-xs text-muted">
          Não sabe exportar as pistas?{" "}
          <Link href="/ajuda#fl-studio" className="text-violet-200 underline">
            Veja o passo a passo (FL Studio, Reaper, Studio One, Cubase e celular)
          </Link>
          .
        </p>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => void add(e.target.files).then(() => e.target && (e.target.value = ""))} />
        {tracks.length === 0 ? (
          <button type="button" onClick={() => input.current?.click()} className="flex flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-violet-400/50 p-8 text-center hover:bg-primary/10">
            <Upload className="size-6" aria-hidden />
            <span className="font-semibold">Escolher as pistas</span>
            <span className="text-xs text-muted">Selecione todos os arquivos de uma vez</span>
          </button>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5">
              {tracks.map((t, i) => (
                <li key={`${t.file.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{t.file.name}</span>
                  <span className="text-xs text-muted">{t.duration ? formatDuration(t.duration) : "não lido"}</span>
                  <select
                    value={t.role}
                    onChange={(e) => setTracks((x) => x.map((y, k) => (k === i ? { ...y, role: e.target.value as TrackRole } : y)))}
                    aria-label={`Instrumento de ${t.file.name}`}
                    className="h-9 rounded-lg border border-border-strong bg-black/20 px-2 text-xs"
                  >
                    {TRACK_ROLES.filter((r) => r !== "playback").map((r) => (
                      <option key={r} value={r}>
                        {ROLE_PT[r]}
                      </option>
                    ))}
                  </select>
                  <button type="button" aria-label="Remover" onClick={() => setTracks((x) => x.filter((_, k) => k !== i))} className="text-muted hover:text-rose-300">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="secondary" size="sm" className="self-start" onClick={() => input.current?.click()} disabled={tracks.length >= 24}>
              <Plus className="size-4" aria-hidden /> Adicionar pistas
            </Button>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Music4 className="size-5 text-violet-300" aria-hidden /> 2. O som que você quer
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            Estilo
            <select value={genre} onChange={(e) => setGenre(e.target.value)} className="h-11 rounded-xl border border-border-strong bg-black/20 px-3">
              {MIX_GENRES.map((g) => (
                <option key={g} value={g}>
                  {GENRE_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Master
            <select value={master} onChange={(e) => setMaster(e.target.value)} className="h-11 rounded-xl border border-border-strong bg-black/20 px-3">
              <option value="">Automático pelo estilo</option>
              {masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border p-3 text-sm">
          <span className="font-medium">Música de referência (opcional)</span>
          <span className="text-xs text-muted">Uma música com o som que você quer. Só é analisada (nunca copiada) e é apagada depois.</span>
          <input ref={refInput} type="file" accept=".wav,.mp3,.m4a,.flac,audio/*" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setRef({ file: f, duration: await fileDuration(f) });
          }} />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => refInput.current?.click()}>
              {ref ? "Trocar referência" : "Escolher referência"}
            </Button>
            {ref && <span className="truncate text-xs">{ref.file.name}</span>}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} className="size-4 accent-violet-500" />
            Alinhar fase e tempo dos microfones (bateria, baixo, violão)
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex justify-between">
              Afinação da voz <span className="font-mono text-violet-200">{tune ? `${tune}%` : "desligada"}</span>
            </span>
            <input type="range" min={0} max={100} step={5} value={tune} onChange={(e) => setTune(Number(e.target.value))} className="accent-violet-500" />
            <span className="text-xs text-subtle">Natural: corrige o centro de cada nota e mantém o vibrato. 30–60% soa humano.</span>
          </label>
        </div>
      </Card>

      {busy !== null ? (
        <ProgressBar value={busy} label="Enviando as pistas" />
      ) : (
        <Button size="lg" onClick={() => void go()} disabled={tracks.length < 2}>
          Ouvir a prévia grátis (30 s)
        </Button>
      )}

      <ShowcaseStrip product="mix_ia" title="Mixagens feitas aqui" />
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-semibold">Perguntas frequentes</h2>
        <Faq items={MIX_FAQ} />
      </section>
    </div>
  );
}
