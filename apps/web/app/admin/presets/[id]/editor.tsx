"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Trash2, Upload } from "lucide-react";
import {
  EMPTY_CHAIN,
  INTENSITIES,
  MODULES,
  MODULE_TYPES,
  presetChainSchema,
  resolveParam,
  type ModuleType,
  type NumberParam,
  type ParamSpec,
  type PresetChain,
} from "@mixpro/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { cn, formatDateTime } from "@/lib/cn";
import type { Preset, PresetCategory, PresetVersion } from "@/lib/types";

export type EditorPreset = Preset;

type RawNum = number | { value: number; neutral?: number };
type EditableModule = { type: ModuleType; label?: string; bypass?: boolean; params: Record<string, RawNum | string> };

const STYLES = ["punchy", "warm", "bright", "clean", "aggressive", "modern", "vintage", "deep", "wide", "natural", "radio", "powerful", "intimate", "heavy"];

const input =
  "h-10 w-full rounded-lg border border-border-strong bg-black/20 px-3 text-sm outline-none focus:border-violet-400";

function slugify(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function defaultModule(type: ModuleType): EditableModule {
  const params: EditableModule["params"] = {};
  for (const [name, p] of Object.entries(MODULES[type].params) as [string, ParamSpec][]) {
    params[name] = p.kind === "enum" ? p.default : p.interpolable ? { value: p.default, neutral: p.neutral } : p.default;
  }
  return { type, params };
}

function cleanChain(mods: EditableModule[]): PresetChain {
  return {
    schema_version: 1,
    chain: mods.map((m) => {
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m.params)) {
        if (v && typeof v === "object") params[k] = v.neutral === undefined ? { value: v.value } : { value: v.value, neutral: v.neutral };
        else params[k] = v;
      }
      return { type: m.type, ...(m.label ? { label: m.label } : {}), ...(m.bypass ? { bypass: true } : {}), params };
    }),
  } as PresetChain;
}

export function PresetEditor({
  preset,
  versions,
  categories,
  usage,
}: {
  preset: EditorPreset | null;
  versions: PresetVersion[];
  categories: PresetCategory[];
  usage: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = supabaseBrowser();
  const current = versions.find((v) => v.id === preset?.current_version_id) ?? versions[0];

  const [meta, setMeta] = useState({
    name: preset?.name ?? "",
    slug: preset?.slug ?? "",
    category_id: preset?.category_id ?? categories[0]?.id ?? "",
    style: preset?.style ?? "clean",
    description: preset?.description ?? "",
    tags: (preset?.tags ?? []).join(", "),
    image_url: preset?.image_url ?? "",
    active: preset?.active ?? false,
    position: preset?.position ?? 0,
  });
  const [mods, setMods] = useState<EditableModule[]>(() => (current?.chain ?? EMPTY_CHAIN).chain as unknown as EditableModule[]);
  const [defaultIntensity, setDefaultIntensity] = useState<number>(current?.default_intensity ?? 50);
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<number>(50);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const chain = useMemo(() => cleanChain(mods), [mods]);
  const validation = useMemo(() => presetChainSchema.safeParse(chain), [chain]);
  const savedChain = JSON.stringify(current?.chain ?? EMPTY_CHAIN);
  const chainChanged = JSON.stringify(chain) !== savedChain || defaultIntensity !== (current?.default_intensity ?? 50);

  const update = (i: number, fn: (m: EditableModule) => EditableModule) => setMods((cur) => cur.map((m, j) => (j === i ? fn(m) : m)));
  const move = (i: number, d: -1 | 1) =>
    setMods((cur) => {
      const next = [...cur];
      const [m] = next.splice(i, 1);
      next.splice(i + d, 0, m);
      return next;
    });

  async function saveMeta() {
    if (!meta.name.trim()) return toast.error("Informe o nome.");
    const slug = meta.slug || slugify(meta.name);
    if (meta.active && !(current?.chain?.chain?.length || chain.chain.length)) {
      return toast.error("Defina e publique a cadeia antes de ativar o preset.");
    }
    setSaving("meta");
    const row = {
      name: meta.name.trim(),
      slug,
      category_id: meta.category_id,
      style: meta.style,
      description: meta.description.trim() || null,
      tags: meta.tags.split(",").map((t) => t.trim()).filter(Boolean),
      image_url: meta.image_url.trim() || null,
      active: meta.active,
      position: Number(meta.position) || 0,
    };
    if (preset) {
      const { error } = await supabase.from("presets").update(row).eq("id", preset.id);
      setSaving(null);
      if (error) return toast.error(error.message.includes("duplicate") ? "Já existe um preset com esse identificador." : "Erro ao salvar.");
      toast.success("Dados salvos.");
      router.refresh();
    } else {
      const { data, error } = await supabase.from("presets").insert({ ...row, active: false }).select("id").single();
      if (error || !data) {
        setSaving(null);
        return toast.error(error?.message.includes("duplicate") ? "Já existe um preset com esse identificador." : "Erro ao criar.");
      }
      await supabase.rpc("publish_preset_version", { p_preset: data.id, p_chain: chain, p_default_intensity: defaultIntensity, p_notes: notes || "Versão inicial" });
      setSaving(null);
      toast.success("Preset criado.");
      router.replace(`/admin/presets/${data.id}`);
    }
  }

  async function publish() {
    if (!preset) return;
    if (!validation.success) return toast.error("Corrija a cadeia antes de publicar.");
    setSaving("publish");
    const { error } = await supabase.rpc("publish_preset_version", {
      p_preset: preset.id,
      p_chain: chain,
      p_default_intensity: defaultIntensity,
      p_notes: notes || null,
    });
    setSaving(null);
    if (error) return toast.error("Erro ao publicar a versão.");
    setNotes("");
    toast.success("Nova versão publicada. Projetos antigos continuam usando a versão anterior.");
    router.refresh();
  }

  async function duplicate() {
    if (!preset) return;
    setSaving("dup");
    const { data, error } = await supabase
      .from("presets")
      .insert({
        name: `${meta.name} (cópia)`,
        slug: `${preset.slug}-copia-${Date.now().toString(36).slice(-4)}`,
        category_id: meta.category_id,
        style: meta.style,
        description: meta.description,
        tags: preset.tags,
        active: false,
      })
      .select("id")
      .single();
    if (!error && data) {
      await supabase.rpc("publish_preset_version", { p_preset: data.id, p_chain: chain, p_default_intensity: defaultIntensity, p_notes: `Duplicado de ${meta.name}` });
    }
    setSaving(null);
    if (error || !data) return toast.error("Erro ao duplicar.");
    router.push(`/admin/presets/${data.id}`);
  }

  async function remove() {
    if (!preset || !confirm(usage ? "Este preset já foi usado e será ARQUIVADO (não aparece mais para os usuários). Continuar?" : "Excluir este preset definitivamente?"))
      return;
    const { data, error } = await supabase.rpc("admin_delete_preset", { p_preset: preset.id });
    if (error) return toast.error("Erro ao excluir.");
    toast.success(data === "archived" ? "Preset arquivado." : "Preset excluído.");
    router.push("/admin/presets");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/presets" aria-label="Voltar" className="rounded-full p-2 text-muted hover:bg-white/5">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="font-display text-2xl font-semibold">{preset ? meta.name : "Novo preset"}</h1>
            {preset && (
              <p className="text-xs text-muted">
                Versão atual v{current?.version ?? "—"} · usado em {usage} processamentos
                {preset.archived_at && " · ARQUIVADO"}
              </p>
            )}
          </div>
        </div>
        {preset && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={duplicate} loading={saving === "dup"}>
              <Copy className="size-4" aria-hidden /> Duplicar
            </Button>
            <Button variant="danger" size="sm" onClick={remove}>
              <Trash2 className="size-4" aria-hidden /> {usage ? "Arquivar" : "Excluir"}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="flex h-fit flex-col gap-3 p-5">
          <h2 className="font-medium">Dados do preset</h2>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Nome
            <input className={input} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value, slug: preset ? meta.slug : slugify(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Identificador (slug)
            <input className={input} value={meta.slug} onChange={(e) => setMeta({ ...meta, slug: slugify(e.target.value) })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Categoria
              <select className={input} value={meta.category_id} onChange={(e) => setMeta({ ...meta, category_id: e.target.value })}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Estilo
              <select className={input} value={meta.style} onChange={(e) => setMeta({ ...meta, style: e.target.value })}>
                {STYLES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Descrição (linguagem leiga)
            <input className={input} value={meta.description} maxLength={120} onChange={(e) => setMeta({ ...meta, description: e.target.value })} placeholder="Ex.: Mais ataque e definição." />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Tags (separadas por vírgula)
            <input className={input} value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            URL da imagem (opcional)
            <input className={input} value={meta.image_url} onChange={(e) => setMeta({ ...meta, image_url: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Ordem
              <input type="number" className={input} value={meta.position} onChange={(e) => setMeta({ ...meta, position: Number(e.target.value) })} />
            </label>
            <label className="mt-5 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={meta.active} onChange={(e) => setMeta({ ...meta, active: e.target.checked })} className="size-4 accent-violet-500" />
              Ativo
            </label>
          </div>
          <Button onClick={saveMeta} loading={saving === "meta"}>
            {preset ? "Salvar dados" : "Criar preset"}
          </Button>

          {versions.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <h3 className="mb-2 text-sm font-medium">Versões</h3>
              <ol className="flex flex-col gap-2">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-start justify-between gap-2 text-xs">
                    <div>
                      <span className="font-medium">v{v.version}</span>
                      {v.id === preset?.current_version_id && <Badge tone="success" className="ml-2">atual</Badge>}
                      <p className="text-subtle">
                        {formatDateTime(v.created_at)} · {v.chain.chain.length} módulos
                      </p>
                      {v.notes && <p className="text-muted">{v.notes}</p>}
                    </div>
                    <button
                      className="shrink-0 text-violet-300 hover:underline"
                      onClick={() => {
                        setMods(v.chain.chain as unknown as EditableModule[]);
                        setDefaultIntensity(v.default_intensity);
                        toast.info(`v${v.version} carregada no editor. Publique para torná-la atual.`);
                      }}
                    >
                      Carregar
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-medium">Cadeia de processamento</h2>
                <p className="text-xs text-muted">
                  Ordem de cima para baixo. Parâmetros “variam com intensidade” interpolam entre o valor em 0% e em 100%.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                Visualizar em
                {INTENSITIES.map((i) => (
                  <button key={i} onClick={() => setPreview(i)} className={cn("rounded-full px-2 py-1", preview === i ? "bg-white/10 text-text" : "hover:text-text")}>
                    {i}%
                  </button>
                ))}
              </div>
            </div>

            {mods.length === 0 && (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
                Nenhum módulo. Adicione o primeiro processamento abaixo.
              </p>
            )}

            {mods.map((m, i) => (
              <ModuleEditor
                key={i}
                index={i}
                mod={m}
                total={mods.length}
                previewIntensity={preview}
                onChange={(next) => update(i, () => next)}
                onMove={(d) => move(i, d)}
                onRemove={() => setMods((cur) => cur.filter((_, j) => j !== i))}
              />
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <select
                className={cn(input, "w-auto")}
                value=""
                onChange={(e) => {
                  if (e.target.value) setMods((cur) => [...cur, defaultModule(e.target.value as ModuleType)]);
                }}
                aria-label="Adicionar módulo"
              >
                <option value="">+ Adicionar módulo…</option>
                {MODULE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MODULES[t].label}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setJsonText(JSON.stringify(chain, null, 2));
                  setJsonOpen(true);
                }}
              >
                <Upload className="size-4" aria-hidden /> JSON
              </Button>
            </div>
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            {!validation.success && (
              <ul className="rounded-xl bg-danger/10 p-3 text-xs text-red-300">
                {validation.error.issues.slice(0, 6).map((iss, k) => (
                  <li key={k}>
                    {iss.path.join(" › ")}: {iss.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Intensidade padrão
                <select className={input} value={defaultIntensity} onChange={(e) => setDefaultIntensity(Number(e.target.value))}>
                  {INTENSITIES.map((i) => (
                    <option key={i} value={i}>
                      {i}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Notas da versão
                <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="O que mudou nesta versão?" />
              </label>
            </div>
            {preset ? (
              <Button onClick={publish} loading={saving === "publish"} disabled={!chainChanged || !validation.success}>
                Publicar nova versão (v{(versions[0]?.version ?? 0) + 1})
              </Button>
            ) : (
              <p className="text-xs text-muted">A cadeia será publicada como v1 ao criar o preset.</p>
            )}
            <p className="text-[11px] text-subtle">
              Para ouvir: abra um projeto seu no app. Como administrador, você vê também presets inativos (com cadeia publicada).
            </p>
          </Card>
        </div>
      </div>

      <Modal open={jsonOpen} onClose={() => setJsonOpen(false)} title="Cadeia em JSON" className="md:max-w-2xl">
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          spellCheck={false}
          className="h-80 w-full rounded-xl border border-border-strong bg-black/30 p-3 font-mono text-xs outline-none focus:border-violet-400"
          aria-label="JSON da cadeia"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigator.clipboard.writeText(jsonText)}>
            Copiar
          </Button>
          <Button
            onClick={() => {
              try {
                const parsed = presetChainSchema.safeParse(JSON.parse(jsonText));
                if (!parsed.success) return toast.error(`JSON inválido: ${parsed.error.issues[0]?.message}`);
                setMods(parsed.data.chain as unknown as EditableModule[]);
                setJsonOpen(false);
              } catch {
                toast.error("JSON mal formatado.");
              }
            }}
          >
            Importar
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ModuleEditor({
  index,
  mod,
  total,
  previewIntensity,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  mod: EditableModule;
  total: number;
  previewIntensity: number;
  onChange: (m: EditableModule) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const spec = MODULES[mod.type];
  const setParam = (name: string, v: RawNum | string) => onChange({ ...mod, params: { ...mod.params, [name]: v } });

  return (
    <div className={cn("rounded-2xl border border-border bg-black/15 p-4", mod.bypass && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-full bg-white/8 text-xs tabular-nums">{index + 1}</span>
          <span className="font-medium">{spec.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <label className="mr-2 flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={!!mod.bypass} onChange={(e) => onChange({ ...mod, bypass: e.target.checked || undefined })} className="accent-violet-500" />
            Bypass
          </label>
          <button onClick={() => onMove(-1)} disabled={index === 0} aria-label="Mover para cima" className="rounded p-1.5 text-muted hover:bg-white/5 disabled:opacity-30">
            <ArrowUp className="size-4" />
          </button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Mover para baixo" className="rounded p-1.5 text-muted hover:bg-white/5 disabled:opacity-30">
            <ArrowDown className="size-4" />
          </button>
          <button onClick={onRemove} aria-label="Remover módulo" className="rounded p-1.5 text-red-300 hover:bg-danger/10">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <label className="mt-3 flex flex-col gap-1 text-xs text-muted">
        Texto para o usuário leigo (opcional)
        <input
          className={input}
          value={mod.label ?? ""}
          maxLength={80}
          placeholder={spec.description}
          onChange={(e) => onChange({ ...mod, label: e.target.value || undefined })}
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.entries(spec.params) as [string, ParamSpec][]).map(([name, p]) => {
          const raw = mod.params[name];
          if (p.kind === "enum") {
            return (
              <label key={name} className="flex flex-col gap-1 text-xs text-muted">
                {p.label}
                <select className={input} value={String(raw ?? p.default)} onChange={(e) => setParam(name, e.target.value)}>
                  {p.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          const np = p as NumberParam;
          const interp = typeof raw === "object" && raw !== null;
          const value = interp ? (raw as { value: number }).value : ((raw as number | undefined) ?? np.default);
          const neutral = interp ? ((raw as { neutral?: number }).neutral ?? np.neutral ?? value) : undefined;
          const effective = resolveParam(raw as RawNum | undefined, np, previewIntensity);
          const num = (v: string) => Math.min(np.max, Math.max(np.min, Number(v)));
          return (
            <div key={name} className="flex flex-col gap-1 text-xs text-muted">
              <div className="flex items-center justify-between">
                <span>
                  {np.label} {np.unit && <span className="text-subtle">({np.unit})</span>}
                </span>
                {np.interpolable && (
                  <button
                    type="button"
                    className={cn("rounded px-1.5 text-[10px]", interp ? "bg-primary/20 text-violet-200" : "text-subtle hover:text-text")}
                    onClick={() => setParam(name, interp ? value : { value, neutral: np.neutral })}
                    title="Alternar entre valor fixo e valor que varia com a intensidade"
                  >
                    {interp ? "varia c/ intensidade" : "fixo"}
                  </button>
                )}
              </div>
              {interp ? (
                <div className="grid grid-cols-2 gap-1">
                  <input type="number" step={np.step} min={np.min} max={np.max} className={input} value={neutral} aria-label={`${np.label} em 0%`} title="Valor em 0%" onChange={(e) => setParam(name, { value, neutral: num(e.target.value) })} />
                  <input type="number" step={np.step} min={np.min} max={np.max} className={input} value={value} aria-label={`${np.label} em 100%`} title="Valor em 100%" onChange={(e) => setParam(name, { value: num(e.target.value), neutral })} />
                </div>
              ) : (
                <input type="number" step={np.step} min={np.min} max={np.max} className={input} value={value} onChange={(e) => setParam(name, num(e.target.value))} />
              )}
              <span className="text-[10px] text-subtle">
                {interp ? `0% → 100% · em ${previewIntensity}%: ` : `Faixa ${np.min}–${np.max} · `}
                {Math.round(effective * 100) / 100}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
