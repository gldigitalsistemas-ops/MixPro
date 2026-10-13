"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { put } from "@/lib/export/server-client";
import { guessRole } from "@/lib/mixengine/roles";
import { TRAINING_GENRES, type TrainingKind } from "@/lib/premium/training";
import { cn } from "@/lib/cn";

export type TrainingRow = { id: string; genre: string; title: string; artist: string; source: string; status: string; files: number; stems: number; created: string };

async function act(body: Record<string, unknown>) {
  const r = await fetch("/api/admin/training", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Não foi possível.");
  return j;
}

/** Formulário de uma música: dados, direitos e arquivos (o tipo de cada arquivo é sugerido pelo nome). */
export function TrainingUpload() {
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [genre, setGenre] = useState(TRAINING_GENRES[0].id);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [source, setSource] = useState<"proprio" | "parceiro">("proprio");
  const [rights, setRights] = useState(false);
  const [note, setNote] = useState("");
  const [bpm, setBpm] = useState("");
  const [key, setKey] = useState("");
  const [files, setFiles] = useState<{ file: File; kind: TrainingKind }[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  function pick(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list).map((file) => {
      const n = file.name.toLowerCase();
      const kind: TrainingKind = /(guia|guide|demo|voz e viol)/.test(n) ? "guia" : /(mix|master|final|stereo)/.test(n) || guessRole(file.name) === "other" ? "mix" : "stem";
      return { file, kind };
    });
    setFiles((f) => [...f, ...arr].slice(0, 30));
  }

  async function send() {
    if (!title.trim()) return toast.error("Dê um título.");
    if (!rights) return toast.error("Confirme os direitos (sua ou de parceiro com autorização por escrito).");
    if (!files.some((f) => f.kind === "mix")) return toast.error("Marque pelo menos um arquivo como “mix final”.");
    setBusy(0);
    try {
      const r = await act({ action: "create", genre, title, artist, source, rights_confirmed: rights, rights_note: note, bpm: bpm ? Number(bpm) : null, key, files: files.map((f) => ({ name: f.file.name, bytes: f.file.size, kind: f.kind })) });
      const total = files.reduce((a, f) => a + f.file.size, 0) || 1;
      let sent = 0;
      for (let i = 0; i < files.length; i++) {
        const before = sent;
        await put(r.uploads[i], files[i].file, (p: number) => setBusy(((before + p * files[i].file.size) / total) * 100), undefined, () => new XMLHttpRequest());
        sent += files[i].file.size;
      }
      toast.success("Música enviada para o treino.");
      setTitle("");
      setArtist("");
      setNote("");
      setBpm("");
      setKey("");
      setFiles([]);
      setRights(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const field = "h-10 rounded-xl border border-border-strong bg-black/20 px-3 text-sm";
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="font-display text-lg font-semibold">Enviar uma música para o treino</h2>
      <div className="grid gap-2 md:grid-cols-3">
        <select value={genre} onChange={(e) => setGenre(e.target.value)} className={field} aria-label="Gênero">
          {TRAINING_GENRES.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da música" maxLength={120} className={field} />
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artista / produtor" maxLength={120} className={field} />
        <select value={source} onChange={(e) => setSource(e.target.value as "proprio" | "parceiro")} className={field} aria-label="Origem">
          <option value="proprio">Produção minha</option>
          <option value="parceiro">Produção de parceiro</option>
        </select>
        <input value={bpm} onChange={(e) => setBpm(e.target.value.replace(/[^\d.]/g, ""))} placeholder="BPM (opcional)" className={field} />
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Tom (ex.: Ré maior)" maxLength={20} className={field} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 size-4 accent-violet-500" />
        <span>Confirmo que a música é minha ou que o parceiro autorizou por escrito o uso para treinar a IA do Mix Pro.</span>
      </label>
      {source === "parceiro" && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quem autorizou e onde está a autorização (ex.: e-mail de 10/10/2026)" maxLength={500} className={field} />}
      <input ref={input} type="file" multiple accept=".wav,.aif,.aiff,.flac,.mp3,.m4a" className="hidden" onChange={(e) => pick(e.target.files)} />
      <Button variant="secondary" size="sm" className="self-start" onClick={() => input.current?.click()}>
        <Upload className="size-4" aria-hidden /> Escolher arquivos (mix, faixas e guia)
      </Button>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((f, i) => (
            <li key={`${f.file.name}-${i}`} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
              <select value={f.kind} onChange={(e) => setFiles((x) => x.map((y, k) => (k === i ? { ...y, kind: e.target.value as TrainingKind } : y)))} className="h-8 rounded-lg border border-border-strong bg-black/20 px-2 text-xs" aria-label="Tipo">
                <option value="mix">Mix final</option>
                <option value="stem">Faixa separada</option>
                <option value="guia">Guia (voz e violão)</option>
              </select>
              <button type="button" aria-label="Remover" onClick={() => setFiles((x) => x.filter((_, k) => k !== i))} className="text-muted hover:text-rose-300">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy !== null ? <ProgressBar value={busy} label="Enviando" /> : <Button className="self-start" onClick={() => void send()}>Enviar para o treino</Button>}
    </Card>
  );
}

export function TrainingList({ rows }: { rows: TrainingRow[] }) {
  const toast = useToast();
  const router = useRouter();
  const run = async (body: Record<string, unknown>, ok: string) => {
    try {
      await act(body);
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!rows.length) return <p className="text-sm text-muted">Nenhuma música enviada ainda.</p>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-xs text-subtle">
          <tr className="border-b border-border">
            <th className="px-4 py-3 font-normal">Música</th>
            <th className="px-4 py-3 font-normal">Gênero</th>
            <th className="px-4 py-3 font-normal">Arquivos</th>
            <th className="px-4 py-3 font-normal">Status</th>
            <th className="px-4 py-3 font-normal" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3">
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-muted">
                  {r.artist || "—"} · {r.source === "parceiro" ? "parceiro" : "própria"} · {r.created}
                </p>
              </td>
              <td className="px-4 py-3">{TRAINING_GENRES.find((g) => g.id === r.genre)?.name ?? r.genre}</td>
              <td className={cn("px-4 py-3 text-xs", r.stems ? "" : "text-amber-300")}>
                {r.files} arquivos{r.stems ? ` · ${r.stems} faixas` : " · sem faixas separadas"}
              </td>
              <td className="px-4 py-3">
                <Badge tone={r.status === "ready" ? "success" : r.status === "rejected" ? "neutral" : "warning"}>{r.status === "ready" ? "Pronta" : r.status === "rejected" ? "Descartada" : "Conferir"}</Badge>
              </td>
              <td className="flex gap-1 px-4 py-3">
                {r.status !== "ready" && (
                  <Button size="sm" variant="secondary" onClick={() => void run({ action: "status", id: r.id, status: "ready" }, "Marcada como pronta.")}>
                    <Check className="size-4" aria-hidden /> Pronta
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => window.confirm("Apagar a música e os arquivos?") && void run({ action: "delete", id: r.id }, "Apagada.")}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
