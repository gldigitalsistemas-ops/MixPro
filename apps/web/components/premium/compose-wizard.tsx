"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic2, Music4, Upload } from "lucide-react";
import { MIX_GENRES } from "@mixpro/contracts";
import { useAccountCtx } from "@/components/account/account-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { createProject, startPreview } from "@/lib/premium/client";
import { fileDuration } from "@/lib/tools/client";
import { formatDuration } from "@/lib/cn";
import { reportError } from "@/lib/error-log";
import { PriceTag, useQuote } from "./checkout";
import { Faq, ModuleExplainer } from "./explainer";
import { GENRE_LABEL, ShowcaseStrip } from "./showcase";

export const COMPOSE_FAQ = [
  { q: "A IA copia a música de referência?", a: "Não. A referência só orienta o estilo e a sonoridade. A IA cria um arranjo novo a partir da SUA composição (melodia, acordes e andamento) — e o app confere que o resultado não ficou parecido demais com a referência." },
  { q: "O que eu envio?", a: "A sua composição gravada: só a voz, voz e violão, ou uma guia com banda. Pode ser gravada no celular. Até 6 minutos." },
  { q: "Posso pedir outras versões?", a: "Você recebe 3 versões diferentes e escolhe a que mais gostar. Antes de pagar, ouve 30 segundos de cada." },
  { q: "Como gravo a voz definitiva?", a: "Escolha a versão e grave aqui mesmo (com fone de ouvido) ou envie a gravação do estúdio. A IA afina pela melodia que você cantou na guia (sem soar robótica), trata, mixa e masteriza." },
  { q: "A música é minha?", a: "Sim. A composição e a voz são suas. O arranjo foi gerado com IA: ao distribuir, informe que houve uso de IA na produção (as distribuidoras pedem isso)." },
];

export function ComposeWizard() {
  const router = useRouter();
  const toast = useToast();
  const { requireLogin } = useAccountCtx();
  const [guide, setGuide] = useState<{ file: File; duration: number | null } | null>(null);
  const [ref, setRef] = useState<{ file: File; duration: number | null } | null>(null);
  const [genre, setGenre] = useState("worship");
  const [style, setStyle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [bpm, setBpm] = useState("");
  const [tonic, setTonic] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const gIn = useRef<HTMLInputElement>(null);
  const rIn = useRef<HTMLInputElement>(null);
  const q = useQuote("producao", (guide?.duration ?? 0) / 60);

  async function go() {
    if (!(await requireLogin("Entre na sua conta para produzir a sua música. A prévia é grátis."))) return;
    if (!guide?.duration) return toast.error("Envie a guia (voz, voz e violão ou a guia com banda).");
    const bpmValue = bpm.trim() ? Number(bpm.replace(",", ".")) : null;
    if (bpmValue !== null && !(bpmValue >= 40 && bpmValue <= 240)) return toast.error("O andamento deve ficar entre 40 e 240 BPM (ou deixe em branco).");
    setBusy(0);
    try {
      const files = [{ file: guide.file, name: guide.file.name }, ...(ref ? [{ file: ref.file, name: ref.file.name }] : [])];
      const id = await createProject("producao", files, (v) => setBusy(v * 100), { title: guide.file.name.replace(/\.[^.]+$/, "") });
      await startPreview(id, {
        format: "wav",
        durations: [Math.ceil(guide.duration * 100) / 100, ...(ref ? [Math.ceil((ref.duration ?? 600) * 100) / 100] : [])],
        has_reference: Boolean(ref),
        genre,
        style: style.replace(/[^\p{L}\p{N} ,.;:()&/+'-]/gu, " ").slice(0, 200),
        lyrics: lyrics.replace(/[^\p{L}\p{N} ,.;:()&/+'!?"\-\n]/gu, " ").slice(0, 2000),
        bpm: bpmValue,
        key: tonic || null,
        versions: 3,
        seed: Math.floor(Math.random() * 1_000_000),
      });
      router.push(`/premium/${id}`);
    } catch (e) {
      reportError("produzir", e, { severity: "aviso" });
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <ModuleExplainer
        title="Produza sua composição"
        tagline="Envie a sua música do jeito que ela está (voz, voz e violão ou uma guia) e uma referência de som. A IA cria a produção — você escolhe a versão, grava a voz e recebe a música pronta."
        forWho="Para compositores e cantores que querem tirar a música do papel de forma rápida, sem precisar de um estúdio para o arranjo."
        send={["A guia da sua música (voz, voz e violão ou banda), até 6 min", "Opcional: uma música de referência do som que você quer", "O estilo e, se quiser, uma descrição (ex.: “worship com piano e pads”)"]}
        receive={["3 versões da base no seu andamento e tom", "Folha de cifra (tom, BPM e acordes) e clique", "Depois: a sua voz afinada, mixada e masterizada na base (Voz finalizada ou Pacote)"]}
        time="A prévia das 3 versões sai em poucos minutos. A entrega completa, em até 15 minutos."
        steps={[
          { title: "Envie a guia", text: "Grave no celular mesmo. Se tiver, envie uma referência." },
          { title: "Ouça 3 versões", text: "30 s de cada, grátis, já no seu andamento e tom." },
          { title: "Escolha e grave", text: "Baixe a base, grave a voz (aqui ou no estúdio)." },
          { title: "Receba pronta", text: "Voz afinada sem soar robótica, mixada e masterizada." },
        ]}
        faq={COMPOSE_FAQ}
      />

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Mic2 className="size-5 text-violet-300" aria-hidden /> 1. Sua guia
          </h2>
          <PriceTag q={q} compact />
        </div>
        <input ref={gIn} type="file" accept="audio/*,video/*,.wav,.mp3,.m4a,.aif,.aiff,.flac,.mp4,.mov" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) {
            setGuide({ file: f, duration: await fileDuration(f) });
            // “bpm 155” ou “155 bpm” no nome do arquivo já preenche o andamento
            const m = /(?:bpm\s*(\d{2,3})|(\d{2,3})\s*bpm)/i.exec(f.name);
            const v = Number(m?.[1] ?? m?.[2]);
            if (v >= 40 && v <= 240) setBpm(String(v));
          }
        }} />
        <button type="button" onClick={() => gIn.current?.click()} className="flex flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-violet-400/50 p-6 text-center hover:bg-primary/10">
          <Upload className="size-6" aria-hidden />
          <span className="font-semibold">{guide ? guide.file.name : "Escolher a guia"}</span>
          <span className="text-xs text-muted">{guide?.duration ? formatDuration(guide.duration) : "Áudio ou vídeo, até 6 minutos"}</span>
        </button>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Music4 className="size-5 text-violet-300" aria-hidden /> 2. O som que você imagina
        </h2>
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
          Descreva o som (opcional)
          <input value={style} maxLength={200} onChange={(e) => setStyle(e.target.value)} placeholder="Ex.: worship moderno com piano, pads e guitarras com delay" className="h-11 rounded-xl border border-border-strong bg-black/20 px-3" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            Andamento da guia em BPM (recomendado)
            <input value={bpm} inputMode="decimal" onChange={(e) => setBpm(e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))} placeholder="Ex.: 155" className="h-11 rounded-xl border border-border-strong bg-black/20 px-3" />
            <span className="text-xs text-muted">Se você sabe o andamento, informe: o app não precisa adivinhar e a base sai no tempo certo.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Tom da guia (opcional)
            <select value={tonic} onChange={(e) => setTonic(e.target.value)} className="h-11 rounded-xl border border-border-strong bg-black/20 px-3">
              <option value="">Descobrir sozinho</option>
              {["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"].flatMap((n) => [`${n} maior`, `${n} menor`]).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm">
          Letra da música (opcional)
          <textarea
            value={lyrics}
            maxLength={2000}
            rows={5}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder={"Cole a letra: ela ajuda a IA a seguir as frases e sai impressa na folha da base."}
            className="rounded-xl border border-border-strong bg-black/20 p-3 outline-none focus:border-violet-400"
          />
        </label>
        <div className="flex flex-col gap-2 rounded-2xl border border-border p-3 text-sm">
          <span className="font-medium">Música de referência (opcional)</span>
          <span className="text-xs text-muted">Só orienta o estilo. A IA não copia a referência e ela é apagada depois.</span>
          <input ref={rIn} type="file" accept=".wav,.mp3,.m4a,.flac,audio/*" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setRef({ file: f, duration: await fileDuration(f) });
          }} />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => rIn.current?.click()}>
              {ref ? "Trocar referência" : "Escolher referência"}
            </Button>
            {ref && <span className="truncate text-xs">{ref.file.name}</span>}
          </div>
        </div>
      </Card>

      {busy !== null ? (
        <ProgressBar value={busy} label="Enviando" />
      ) : (
        <Button size="lg" onClick={() => void go()} disabled={!guide}>
          Ouvir as 3 versões grátis (30 s de cada)
        </Button>
      )}

      <ShowcaseStrip product="producao" title="Produções feitas aqui" />
      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-semibold">Perguntas frequentes</h2>
        <Faq items={COMPOSE_FAQ} />
      </section>
    </div>
  );
}
