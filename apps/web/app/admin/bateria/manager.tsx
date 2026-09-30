"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Play, Square, Trash2, Upload } from "lucide-react";
import type { DrumPiece } from "@mixpro/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { BUCKET, fetchDrumLibrary, sampleUrl, type DrumLibraryItem } from "@/lib/drums/library";
import { prepareForUpload } from "@/lib/drums/prepare-upload";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

const PIECES: { value: DrumPiece; label: string; hint: string }[] = [
  { value: "kick", label: "Bumbo", hint: "Bumbo" },
  { value: "snare", label: "Caixa", hint: "Caixa (centro; aro/rimshot como outro item)" },
  { value: "tom", label: "Tom", hint: "Tons de rack — ordene do mais agudo ao mais grave" },
  { value: "floor", label: "Surdo", hint: "Surdo (floor tom)" },
];

const STYLES = [
  { value: "worship", label: "Worship" },
  { value: "poprock", label: "Pop Rock" },
  { value: "reggae", label: "Reggae" },
  { value: "groove", label: "Groove / Funk" },
  { value: "soul", label: "Soul / R&B" },
  { value: "gospel", label: "Gospel" },
  { value: "sertanejo", label: "Sertanejo" },
];

const input = "h-10 w-full rounded-lg border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400";

function StyleToggles({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {STYLES.map((s) => {
        const on = value.includes(s.value);
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== s.value) : [...value, s.value])}
            className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-violet-400 bg-primary/20 text-violet-100" : "border-border text-muted hover:text-text")}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

export function SampleManager() {
  const toast = useToast();
  const sb = supabaseBrowser();
  const [items, setItems] = useState<DrumLibraryItem[] | null>(null);
  const [form, setForm] = useState({ piece: "kick" as DrumPiece, name: "", description: "", styles: [] as string[] });
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(
    () =>
      fetchDrumLibrary(true)
        .then(setItems)
        .catch(() => toast.error("Não foi possível carregar. A migração 20261001000003 já foi rodada no Supabase?")),
    [toast],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => () => audio.current?.pause(), []);

  function play(path: string) {
    audio.current?.pause();
    if (playing === path) return setPlaying(null);
    const a = new Audio(sampleUrl(path));
    audio.current = a;
    a.onended = () => setPlaying(null);
    setPlaying(path);
    a.play().catch(() => setPlaying(null));
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Dê um nome ao tambor (ex.: Bumbo 22 Vintage).");
    if (!files.length) return toast.error("Escolha os arquivos de áudio.");
    if (files.length > 12) return toast.error("No máximo 12 batidas por tambor.");
    const id = crypto.randomUUID();
    const paths: string[] = [];
    try {
      for (const [i, f] of files.entries()) {
        setProgress({ label: `Preparando e enviando ${i + 1} de ${files.length}: ${f.name}`, value: (i / files.length) * 100 });
        const { blob } = await prepareForUpload(f);
        const path = `${form.piece}/${id}/${String(i + 1).padStart(2, "0")}.wav`;
        const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "audio/wav", cacheControl: "31536000", upsert: true });
        if (error) throw new Error(`Envio de ${f.name}: ${error.message}`);
        paths.push(path);
      }
      const position = Math.max(0, ...(items ?? []).filter((s) => s.piece === form.piece).map((s) => s.position)) + 1;
      const { error } = await sb.from("drum_samples").insert({
        id,
        piece: form.piece,
        name: form.name.trim(),
        description: form.description.trim() || null,
        styles: form.styles,
        files: paths,
        position,
      });
      if (error) throw new Error(error.message);
      toast.success(`“${form.name.trim()}” adicionado com ${paths.length} ${paths.length === 1 ? "batida" : "batidas"}.`);
      setForm({ ...form, name: "", description: "" });
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      await reload();
    } catch (err) {
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      toast.error(err instanceof Error ? err.message : "Falha no envio.");
    } finally {
      setProgress(null);
    }
  }

  async function update(item: DrumLibraryItem, patch: Partial<DrumLibraryItem>) {
    setItems((list) => list?.map((s) => (s.id === item.id ? { ...s, ...patch } : s)) ?? null);
    const { error } = await sb.from("drum_samples").update(patch).eq("id", item.id);
    if (error) {
      toast.error("Não foi possível salvar.");
      void reload();
    }
  }

  async function move(item: DrumLibraryItem, dir: -1 | 1) {
    // renumera a lista da peça inteira (posições iguais não trocariam de lugar)
    const list = (items ?? []).filter((s) => s.piece === item.piece);
    const i = list.findIndex((s) => s.id === item.id);
    if (!list[i + dir]) return;
    [list[i], list[i + dir]] = [list[i + dir], list[i]];
    await Promise.all(list.map((s, k) => (s.position === k + 1 ? null : update(s, { position: k + 1 }))));
    void reload();
  }

  async function remove(item: DrumLibraryItem) {
    if (!confirm(`Apagar “${item.name}” e os ${item.files.length} arquivos? Presets que usam este sample voltam para o padrão do estilo.`)) return;
    const { error } = await sb.from("drum_samples").delete().eq("id", item.id);
    if (error) return toast.error("Não foi possível apagar.");
    await sb.storage.from(BUCKET).remove(item.files);
    setItems((list) => list?.filter((s) => s.id !== item.id) ?? null);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Card className="flex h-fit flex-col gap-3 p-5">
        <h2 className="font-medium">Adicionar tambor</h2>
        <form onSubmit={upload} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Peça
            <select className={input} value={form.piece} onChange={(e) => setForm({ ...form, piece: e.target.value as DrumPiece })}>
              {PIECES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-subtle">{PIECES.find((p) => p.value === form.piece)?.hint}</span>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Nome que o usuário vê
            <input className={input} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Bumbo 22 Vintage" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Descrição curta (opcional)
            <input
              className={input}
              value={form.description}
              maxLength={160}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Ex.: Grave redondo, pele porosa, microfone dentro"
            />
          </label>
          <div className="flex flex-col gap-1.5 text-xs text-muted">
            Padrão nos estilos
            <StyleToggles value={form.styles} onChange={(styles) => setForm({ ...form, styles })} />
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Batidas da mesma peça (1 a 12 arquivos: WAV, MP3 ou FLAC)
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a"
              onChange={(e) => setFiles([...(e.target.files ?? [])])}
              className="text-sm text-text file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-text"
            />
            <span className="text-[11px] text-subtle">
              Uma batida por arquivo, da mais leve à mais forte. O app corta o silêncio, junta em mono e salva em WAV 48 kHz.
            </span>
          </label>
          {progress ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs">{progress.label}</p>
              <ProgressBar value={progress.value} label={progress.label} />
            </div>
          ) : (
            <Button type="submit">
              <Upload className="size-4" /> Enviar {files.length ? `${files.length} ${files.length === 1 ? "arquivo" : "arquivos"}` : ""}
            </Button>
          )}
        </form>
      </Card>

      <div className="flex flex-col gap-6">
        {items === null ? (
          <p className="text-sm text-muted">Carregando…</p>
        ) : (
          PIECES.map((p) => {
            const list = items.filter((s) => s.piece === p.value);
            return (
              <section key={p.value} className="flex flex-col gap-2">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted">
                  {p.label} <span className="text-subtle">({list.length})</span>
                </h2>
                {!list.length ? (
                  <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted">
                    Nenhum ainda. Sem sample, o app usa o timbre sintetizado do estilo.
                  </p>
                ) : (
                  <Card className="divide-y divide-border overflow-hidden">
                    {list.map((s, i) => (
                      <div key={s.id} className={cn("flex flex-col gap-2 p-4", !s.active && "opacity-60")}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <input
                            defaultValue={s.name}
                            maxLength={60}
                            onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && update(s, { name: e.target.value.trim() })}
                            aria-label="Nome"
                            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 font-medium outline-none hover:border-border focus:border-violet-400"
                          />
                          <div className="flex items-center gap-1">
                            <Badge tone={s.active ? "success" : "neutral"}>{s.active ? "Ativo" : "Oculto"}</Badge>
                            <button onClick={() => update(s, { active: !s.active })} className="rounded px-2 py-1 text-xs text-muted hover:bg-white/5 hover:text-text">
                              {s.active ? "Ocultar" : "Ativar"}
                            </button>
                            <button onClick={() => move(s, -1)} disabled={i === 0} aria-label="Subir" className="rounded p-1.5 text-muted hover:bg-white/5 disabled:opacity-30">
                              <ArrowUp className="size-4" />
                            </button>
                            <button onClick={() => move(s, 1)} disabled={i === list.length - 1} aria-label="Descer" className="rounded p-1.5 text-muted hover:bg-white/5 disabled:opacity-30">
                              <ArrowDown className="size-4" />
                            </button>
                            <button onClick={() => remove(s)} aria-label="Apagar" className="rounded p-1.5 text-red-300 hover:bg-danger/10">
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                        <input
                          defaultValue={s.description ?? ""}
                          maxLength={160}
                          placeholder="Descrição curta"
                          onBlur={(e) => e.target.value !== (s.description ?? "") && update(s, { description: e.target.value.trim() || null })}
                          aria-label="Descrição"
                          className="rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-xs text-muted outline-none hover:border-border focus:border-violet-400"
                        />
                        <StyleToggles value={s.styles} onChange={(styles) => update(s, { styles })} />
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-subtle">Batidas:</span>
                          {s.files.map((path, k) => (
                            <button
                              key={path}
                              onClick={() => play(path)}
                              className={cn(
                                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                                playing === path ? "border-violet-400 text-violet-100" : "border-border text-muted hover:text-text",
                              )}
                            >
                              {playing === path ? <Square className="size-3" /> : <Play className="size-3" />} {k + 1}
                            </button>
                          ))}
                          <button
                            onClick={() => navigator.clipboard.writeText(s.id).then(() => toast.success("Id copiado (use no editor de presets)."))}
                            className="ml-auto flex items-center gap-1 text-[11px] text-subtle hover:text-text"
                          >
                            <Copy className="size-3" /> id
                          </button>
                        </div>
                      </div>
                    ))}
                  </Card>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
