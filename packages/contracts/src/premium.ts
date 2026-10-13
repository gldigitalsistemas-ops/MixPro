import { z } from "zod";
import { presetChainSchema } from "./chain";
import { TOOL_FORMATS, TOOL_MAX_DURATION_S } from "./tools";

/**
 * Módulos premium: catálogo com preços (1ª experiência e profissional), cálculo do preço de um pedido e
 * parâmetros dos jobs (validados na rota da Vercel e de novo no serviço).
 */
export const PREMIUM_IDS = ["vs_premium", "mix_ia", "producao", "voz_final", "pacote_compositor", "eng_finaliza"] as const;
export type PremiumId = (typeof PREMIUM_IDS)[number];

/** Produtos que têm projeto próprio (os outros são combinações ou serviços humanos). */
export const PROJECT_PRODUCTS = ["vs_premium", "mix_ia", "producao", "voz_final"] as const;
export type ProjectProduct = (typeof PROJECT_PRODUCTS)[number];

export type PremiumItem = {
  id: PremiumId;
  name: string;
  /** Preço da 1ª experiência (uma vez por pessoa); null = sem oferta. */
  intro_brl: number | null;
  price_brl: number;
  enabled: boolean;
  credits_ok?: boolean;
  max_minutes?: number;
  long_max_minutes?: number;
  long_multiplier?: number;
  max_tracks?: number;
  revision_days?: number;
  versions?: number;
};

export type PremiumCatalog = { credit_brl: number; pro_discount_pct: number; items: PremiumItem[] };

export const DEFAULT_PREMIUM: PremiumCatalog = {
  credit_brl: 1,
  pro_discount_pct: 20,
  items: [
    { id: "vs_premium", name: "VS Premium 7 faixas", intro_brl: 19.9, price_brl: 39.9, credits_ok: true, max_minutes: 6, long_max_minutes: 10, long_multiplier: 1.5, enabled: true },
    { id: "mix_ia", name: "Mix & Master IA", intro_brl: 49.9, price_brl: 249, max_tracks: 24, max_minutes: 6, revision_days: 7, enabled: true },
    { id: "producao", name: "Produção da composição", intro_brl: 99.9, price_brl: 597, versions: 3, max_minutes: 6, enabled: true },
    { id: "voz_final", name: "Voz finalizada", intro_brl: 49.9, price_brl: 249, max_minutes: 6, revision_days: 7, enabled: true },
    { id: "pacote_compositor", name: "Pacote compositor", intro_brl: 129.9, price_brl: 749, max_minutes: 6, enabled: true },
    { id: "eng_finaliza", name: "Engenheiro finaliza", intro_brl: null, price_brl: 197, enabled: true },
  ],
};

const money = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
};

/** Lê o ajuste do admin com segurança: o que faltar ou vier fora do esperado volta ao padrão. */
export function parsePremium(v: unknown): PremiumCatalog {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const items = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : [];
  return {
    credit_brl: money(o.credit_brl, 0.05, 10) ?? DEFAULT_PREMIUM.credit_brl,
    pro_discount_pct: money(o.pro_discount_pct, 0, 90) ?? DEFAULT_PREMIUM.pro_discount_pct,
    items: DEFAULT_PREMIUM.items.map((d) => {
      const r = items.find((x) => x?.id === d.id) ?? {};
      const price = money(r.price_brl, 1, 20000) ?? d.price_brl;
      const intro = r.intro_brl === null ? null : (money(r.intro_brl, 0.5, 20000) ?? d.intro_brl);
      const int = (k: keyof PremiumItem, min: number, max: number) => {
        const n = Number(r[k]);
        return Number.isFinite(n) && n >= min && n <= max ? n : (d[k] as number | undefined);
      };
      return {
        ...d,
        name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 60) : d.name,
        price_brl: price,
        // a 1ª experiência nunca fica mais cara que o preço normal
        intro_brl: intro === null ? null : Math.min(intro, price),
        enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
        max_minutes: int("max_minutes", 1, 15),
        long_max_minutes: int("long_max_minutes", 1, 20),
        long_multiplier: int("long_multiplier", 1, 5),
        max_tracks: int("max_tracks", 2, 40),
        revision_days: int("revision_days", 0, 30),
        versions: int("versions", 1, 5),
      };
    }),
  };
}

export type PremiumQuote = {
  product: PremiumId;
  /** Preço a pagar em reais. */
  price_brl: number;
  /** Preço profissional (riscado quando há oferta). */
  list_price_brl: number;
  intro: boolean;
  pro_discount: boolean;
  /** Em créditos (só onde o pagamento em créditos é aceito). */
  credits: number | null;
  /** Música mais longa que o padrão (multiplicador aplicado). */
  long: boolean;
};

const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * Preço de um pedido. A 1ª experiência (quando a pessoa ainda pode usar) vale sobre o preço normal;
 * o desconto do Plano Pro vale sobre o preço profissional — fica o menor dos dois.
 */
export function quotePremium(
  cat: PremiumCatalog,
  product: PremiumId,
  o: { introEligible: boolean; isPro: boolean; minutes?: number },
): PremiumQuote | null {
  const item = cat.items.find((i) => i.id === product);
  if (!item || !item.enabled) return null;
  const minutes = o.minutes ?? 0;
  const long = Boolean(item.max_minutes && minutes > item.max_minutes);
  if (long && (!item.long_max_minutes || minutes > item.long_max_minutes)) return null;
  const mult = long ? (item.long_multiplier ?? 1) : 1;
  const list = cents(item.price_brl * mult);
  const pro = o.isPro ? cents(list * (1 - cat.pro_discount_pct / 100)) : list;
  const intro = o.introEligible && item.intro_brl !== null ? cents(item.intro_brl * mult) : null;
  const useIntro = intro !== null && intro < pro;
  const price = useIntro ? intro : pro;
  return {
    product,
    price_brl: price,
    list_price_brl: list,
    intro: useIntro,
    pro_discount: !useIntro && o.isPro && cat.pro_discount_pct > 0,
    credits: item.credits_ok ? Math.ceil(price / cat.credit_brl) : null,
    long,
  };
}

// ------------------------------------------------------------------ parâmetros dos jobs premium

const duration = z.number().finite().positive().max(TOOL_MAX_DURATION_S);
const format = z.enum(TOOL_FORMATS);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** Papel de cada pista na mixagem (o motor aplica o tratamento de cada um). */
export const TRACK_ROLES = [
  "lead_vocal", "backing_vocal", "kick", "snare", "hihat", "toms", "overheads", "room", "drums", "percussion",
  "bass", "electric_guitar", "acoustic_guitar", "piano", "keys", "synth", "pad", "strings", "brass", "fx", "loop", "playback", "other",
] as const;
export type TrackRole = (typeof TRACK_ROLES)[number];

export const MIX_GENRES = ["pop", "pop_us", "worship", "gospel", "sertanejo", "pagode", "funk", "rock", "trap", "acoustic", "edm", "lofi", "mpb"] as const;
export type MixGenre = (typeof MIX_GENRES)[number];

const trackSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9 ._()+-]{1,60}$/),
    role: z.enum(TRACK_ROLES),
    /** Ajuste do usuário sobre a decisão do motor (dB). */
    gain_db: z.number().min(-24).max(12),
    pan: z.number().min(-1).max(1).nullable(),
    mute: z.boolean(),
    eq_low: z.number().min(-12).max(12),
    eq_mid: z.number().min(-12).max(12),
    eq_high: z.number().min(-12).max(12),
    /** Quantidade de compressão (0–100) e de reverb (0–100); null = o motor decide. */
    comp: z.number().min(0).max(100).nullable(),
    reverb: z.number().min(0).max(100).nullable(),
    /** Afinação (só voz), 0 = desligada. */
    tune: z.number().min(0).max(100),
  })
  .strict();
export type MixTrack = z.infer<typeof trackSchema>;

const masterChain = presetChainSchema.nullable();

export const premiumParamsSchemas = {
  stems_premium: z.object({ project_id: uuid, preview: z.boolean(), format, durations: z.array(duration).length(1) }).strict(),
  mix_ia: z
    .object({
      project_id: uuid,
      preview: z.boolean(),
      format,
      /** Uma por pista e, se houver referência, ela por último. */
      durations: z.array(duration).min(2).max(33),
      has_reference: z.boolean(),
      ref_amount: z.number().min(0).max(1),
      genre: z.enum(MIX_GENRES),
      align: z.boolean(),
      tracks: z.array(trackSchema).min(1).max(32),
      master_chain: masterChain,
      master_name: z.string().max(60).nullable(),
      /** Alvo de loudness da entrega (LUFS). */
      target_lufs: z.number().min(-20).max(-6),
    })
    .strict()
    .refine((p) => p.durations.length === p.tracks.length + (p.has_reference ? 1 : 0), "INVALID_JOB"),
  compose: z
    .object({
      project_id: uuid,
      preview: z.boolean(),
      format,
      /** Guia e, opcionalmente, a referência. */
      durations: z.array(duration).min(1).max(2),
      has_reference: z.boolean(),
      genre: z.enum(MIX_GENRES),
      /** Descrição curta do som desejado (só letras, números e pontuação simples). */
      style: z.string().regex(/^[\p{L}\p{N} ,.;:()&/+'-]{0,200}$/u),
      /** Letra da música (opcional): vai ao gerador e sai impressa na folha da base. */
      lyrics: z.string().regex(/^[\p{L}\p{N} ,.;:()&/+'!?"\-\n]{0,2000}$/u).optional(),
      bpm: z.number().min(40).max(240).nullable(),
      key: z.string().regex(/^[A-G](#|b)? (maior|menor)$/).nullable(),
      versions: z.number().int().min(1).max(5),
      seed: z.number().int().min(0).max(2_147_483_647),
    })
    .strict()
    .refine((p) => p.durations.length === (p.has_reference ? 2 : 1), "INVALID_JOB"),
  voice_final: z
    .object({
      project_id: uuid,
      preview: z.boolean(),
      format,
      /** Voz gravada, base e, opcionalmente, a referência. */
      durations: z.array(duration).min(2).max(3),
      has_reference: z.boolean(),
      ref_amount: z.number().min(0).max(1),
      genre: z.enum(MIX_GENRES),
      tune: z.number().min(0).max(100),
      /** Notas da melodia da guia (MIDI, início e fim em segundos) para afinar pela melodia do compositor. */
      melody: z.array(z.tuple([z.number().min(20).max(100), z.number().min(0).max(TOOL_MAX_DURATION_S), z.number().min(0).max(TOOL_MAX_DURATION_S)])).max(4000).nullable(),
      vocal_level_db: z.number().min(-12).max(12),
      reverb: z.number().min(0).max(100),
      master_chain: masterChain,
      master_name: z.string().max(60).nullable(),
      target_lufs: z.number().min(-20).max(-6),
    })
    .strict()
    .refine((p) => p.durations.length === (p.has_reference ? 3 : 2), "INVALID_JOB"),
} as const;

export const PREMIUM_TOOL_IDS = ["stems_premium", "mix_ia", "compose", "voice_final"] as const;
export type PremiumToolId = (typeof PREMIUM_TOOL_IDS)[number];

export type PremiumParams<T extends PremiumToolId> = z.infer<(typeof premiumParamsSchemas)[T]>;

export function parsePremiumParams(tool: string, raw: unknown): { tool: PremiumToolId; params: { durations: number[]; format: string; project_id: string; preview: boolean } & Record<string, unknown> } | null {
  if (!(PREMIUM_TOOL_IDS as readonly string[]).includes(tool)) return null;
  const r = premiumParamsSchemas[tool as PremiumToolId].safeParse(raw);
  return r.success ? { tool: tool as PremiumToolId, params: r.data as never } : null;
}

/** Produto de cada recurso premium (o pedido pago libera o recurso correspondente). */
export const TOOL_PRODUCT: Record<PremiumToolId, ProjectProduct> = { stems_premium: "vs_premium", mix_ia: "mix_ia", compose: "producao", voice_final: "voz_final" };

/** Pedidos que liberam cada produto (o pacote do compositor libera a produção e a voz). */
export function ordersUnlock(product: PremiumId): ProjectProduct[] {
  if (product === "pacote_compositor") return ["producao", "voz_final"];
  if (product === "eng_finaliza") return [];
  return [product];
}

/** Trecho grátis de prévia (segundos). */
export const PREVIEW_SECONDS = 30;
