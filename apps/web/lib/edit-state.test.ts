import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOOK } from "@/lib/media/color";
import { editSnapshot, mergeVideoTools, restorePatch, type EditSnapshot, type SavedVideoTools } from "./edit-state";

/**
 * Registro como o app grava HOJE no IndexedDB (studio.tsx, efeito "edição salva no aparelho"),
 * com um preset antigo (sem versionId) e uma cor salva antes de existir a vinheta.
 */
const OLD_SNAPSHOT: Record<string, unknown> = {
  preset: { id: "p1", slug: "criador-youtuber", name: "Voz de YouTuber", description: null, style: null, categoryId: "vocal-criador", chain: { schema_version: 1, chain: [] }, defaultIntensity: 75 },
  categoryId: "vocal-criador",
  intensity: 50,
  noise: "light",
  social: false,
  captionState: { captions: [{ start: 0.5, end: 1.2, words: [{ text: "Olá", start: 0.5, end: 1.2 }] }], style: "destaque", position: "bottom", burnIn: true },
  videoTools: {
    cut: "suave",
    format: "9:16",
    fit: "blur",
    watermark: false,
    audiogram: null,
    color: { auto: true, correction: null, filter: "vibrante", amount: 80, sharpen: 25 },
    cta: { enabled: true, text: null, handle: "@perfil" },
  },
  drumTweaks: null,
  reverbTweak: { size: "large", amount: 60 },
  custom: null,
  masterId: "m1",
  autoDecision: "aceito",
  niche: "musica",
  platform: "instagram",
  postEdit: null,
  postVariant: 2,
  tab: "video",
};

/** Cópia LITERAL do applyRestore de components/studio/studio.tsx (commit 70943b2), com setters gravadores. */
function legacyRestore(r: Record<string, unknown>, curVideoTools: SavedVideoTools | null) {
  const calls: Record<string, unknown> = {};
  const set = (k: string) => (v: unknown) => (calls[k] = v);
  const [setPreset, setCategoryId, setIntensity, setNoise, setSocial, setCaptionState, setDrumTweaks, setReverbTweak, setCustom, setMasterId, setAutoDecision, setNiche, setPlatform, setPostEdit, setPostVariant, setTab] =
    ["preset", "categoryId", "intensity", "noise", "social", "captionState", "drumTweaks", "reverbTweak", "custom", "masterId", "autoDecision", "niche", "platform", "postEdit", "postVariant", "tab"].map(set);
  const setVideoTools = (f: (cur: SavedVideoTools | null) => SavedVideoTools) => (calls.videoTools = f(curVideoTools));
  type T = unknown;
  const get = <T,>(k: string) => (k in r ? (r[k] as T) : undefined);
  if (get<T>("preset") !== undefined) setPreset(get<T>("preset")!);
  if (get<T>("categoryId") !== undefined) setCategoryId(get<T>("categoryId")!);
  if (get<T>("intensity") !== undefined) setIntensity(get<T>("intensity")!);
  if (get<T>("noise") !== undefined) setNoise(get<T>("noise")!);
  if (typeof r.social === "boolean") setSocial(r.social);
  if (get<T>("captionState") !== undefined) setCaptionState(get<T>("captionState")!);
  const vt = get<SavedVideoTools | null>("videoTools");
  if (vt) setVideoTools((cur) => (cur ? { ...cur, ...vt, color: { ...cur.color, ...vt.color } } : vt));
  if (get<T>("drumTweaks") !== undefined) setDrumTweaks(get<T>("drumTweaks")!);
  if (get<T>("reverbTweak") !== undefined) setReverbTweak(get<T>("reverbTweak")!);
  if (get<T>("custom") !== undefined) setCustom(get<T>("custom")!);
  if (get<T>("masterId") !== undefined) setMasterId(get<T>("masterId")!);
  const decision = get<"aceito" | "manual" | null>("autoDecision");
  if (decision !== undefined) setAutoDecision(decision);
  if (get<T>("niche") !== undefined) setNiche(get<T>("niche")!);
  if (get<T>("platform") !== undefined) setPlatform(get<T>("platform")!);
  if (get<T>("postEdit") !== undefined) setPostEdit(get<T>("postEdit")!);
  if (typeof r.postVariant === "number") setPostVariant(r.postVariant);
  if (typeof r.tab === "string") setTab(r.tab);
  return calls;
}

/** O que a versão nova faz: restorePatch + mergeVideoTools (como o studio.tsx aplica). */
function newRestore(r: Record<string, unknown>, curVideoTools: SavedVideoTools | null) {
  const p = restorePatch(r) as Record<string, unknown>;
  if (p.videoTools) p.videoTools = mergeVideoTools(curVideoTools, p.videoTools as SavedVideoTools);
  return p;
}

const CURRENT_TOOLS: SavedVideoTools = {
  cut: "off",
  format: "original",
  fit: "blur",
  watermark: true,
  audiogram: null,
  color: { ...DEFAULT_LOOK, correction: { exposure: 1.1, contrast: 1, saturation: 1, wb: [1, 1, 1], notes: [] } },
  cta: { enabled: true, text: null, handle: "" },
};

test("snapshot no formato antigo volta exatamente como antes (com e sem ferramentas de vídeo atuais)", () => {
  for (const cur of [null, CURRENT_TOOLS]) {
    const want = legacyRestore(structuredClone(OLD_SNAPSHOT), cur);
    assert.deepEqual(newRestore(structuredClone(OLD_SNAPSHOT), cur), want);
  }
  // a cor antiga (sem vinheta) ganha a vinheta das ferramentas atuais, como antes
  const merged = newRestore(structuredClone(OLD_SNAPSHOT), CURRENT_TOOLS).videoTools as SavedVideoTools;
  assert.equal(merged.color.vignette, 0);
  assert.equal(merged.color.filter, "vibrante");
  // a correção salva (null) sobrescreve a atual, como antes; o estúdio recalcula ao analisar o vídeo
  assert.equal(merged.color.correction, null);
});

test("registros incompletos, com tipos errados ou chaves a mais: mesmo comportamento de antes", () => {
  const cases: Record<string, unknown>[] = [
    {},
    { social: "sim", postVariant: "2", tab: 3, videoTools: null },
    { preset: undefined, intensity: null, masterId: null, extra: 1 },
    { autoDecision: undefined, noise: "strong", tab: "som" },
    { videoTools: OLD_SNAPSHOT.videoTools },
  ];
  for (const r of cases)
    for (const cur of [null, CURRENT_TOOLS]) assert.deepEqual(newRestore(structuredClone(r), cur), legacyRestore(structuredClone(r), cur), JSON.stringify(r));
});

test("o que é gravado: mesmas chaves de sempre e imagem do audiograma retirada", () => {
  const state = { ...(structuredClone(OLD_SNAPSHOT) as unknown as EditSnapshot) };
  state.videoTools = { ...state.videoTools!, audiogram: { palette: 2, title: "Meu podcast", image: {} as ImageBitmap } };
  const saved = editSnapshot(state);
  assert.deepEqual(Object.keys(saved), Object.keys(OLD_SNAPSHOT));
  assert.deepEqual(saved.videoTools!.audiogram, { palette: 2, title: "Meu podcast", image: null });
  assert.notEqual(state.videoTools!.audiogram!.image, null, "não altera o estado original");
  // ida e volta: o que foi gravado restaura o mesmo estado
  assert.deepEqual(newRestore(structuredClone(editSnapshot(structuredClone(OLD_SNAPSHOT) as unknown as EditSnapshot)), null), OLD_SNAPSHOT);
});
