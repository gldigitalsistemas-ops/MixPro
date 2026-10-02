/**
 * Catálogo dos módulos DSP suportados pelo motor.
 * Fonte única de verdade: gera o JSON Schema usado pelo worker (Python),
 * valida cadeias no admin e alimenta o editor de presets.
 */

export type ParamSpec =
  | {
      kind: "number";
      label: string;
      unit?: string;
      min: number;
      max: number;
      step: number;
      default: number;
      /** Pode ser interpolado pela intensidade (value em 100%, neutral em 0%). */
      interpolable: boolean;
      /** Valor que equivale a "sem efeito" — sugerido como neutral no editor. */
      neutral?: number;
    }
  | {
      kind: "enum";
      label: string;
      options: readonly { value: string; label: string }[];
      default: string;
    }
  | {
      /** Arquivo da biblioteca (id): sample de bateria ou caixa (IR). "synth"/"" = padrão. */
      kind: "sample";
      label: string;
      piece: DrumPiece | "ir";
      default: string;
    };

export type NumberParam = Extract<ParamSpec, { kind: "number" }>;
export type EnumParam = Extract<ParamSpec, { kind: "enum" }>;
export type SampleParam = Extract<ParamSpec, { kind: "sample" }>;

/** Tipos de peça da biblioteca de samples de bateria. */
export const DRUM_PIECES = ["kick", "snare", "tom", "floor", "rimshot"] as const;
export type DrumPiece = (typeof DRUM_PIECES)[number];

const sample = (label: string, piece: DrumPiece | "ir"): SampleParam => ({ kind: "sample", label, piece, default: "" });
const tune = (label: string) => num(label, "st", -6, 6, 0.5, 0, false);

/** Modelos de amplificador (guitarra e baixo). */
export const AMP_MODELS = [
  { value: "clean_us", label: "Limpo Americano", group: "guitar", hint: "Limpo cristalino, graves firmes e brilho — o clássico dos palcos." },
  { value: "jazz_clean", label: "Jazz Cristalino", group: "guitar", hint: "Transistor bem limpo e redondo, para jazz, funk e worship." },
  { value: "crunch_uk", label: "Crunch Britânico", group: "guitar", hint: "Válvula quebrando de leve, médios agudos marcantes, muito dinâmico." },
  { value: "rock_classic", label: "Rock Clássico", group: "guitar", hint: "Drive de válvula encorpado dos anos 70/80, médios na cara." },
  { value: "hi_gain", label: "Hi-Gain Moderno", group: "guitar", hint: "Distorção pesada e apertada para rock pesado e metal." },
  { value: "bass_vintage", label: "Baixo Valvulado", group: "bass", hint: "Grave gordo e quente de amplificador valvulado de estúdio." },
  { value: "bass_modern", label: "Baixo Moderno Drive", group: "bass", hint: "Graves limpos com drive nos médios agudos, som de baixo moderno." },
  { value: "bass_clean", label: "Baixo Limpo Hi-Fi", group: "bass", hint: "Transparente e definido, bom para slap e louvor." },
] as const;
export type AmpModel = (typeof AMP_MODELS)[number]["value"];

export const CABINETS = [
  { value: "auto", label: "Do amplificador" },
  { value: "1x12", label: "Caixa 1x12" },
  { value: "2x12", label: "Caixa 2x12" },
  { value: "4x12", label: "Caixa 4x12" },
  { value: "4x10b", label: "Baixo 4x10" },
  { value: "8x10b", label: "Baixo 8x10" },
  { value: "none", label: "Sem caixa (linha)" },
] as const;

export type ModuleSpec = {
  label: string;
  /** Descrição leiga (modo simples). */
  description: string;
  params: Record<string, ParamSpec>;
};

const num = (
  label: string,
  unit: string | undefined,
  min: number,
  max: number,
  step: number,
  def: number,
  interpolable: boolean,
  neutral?: number,
): NumberParam => ({ kind: "number", label, unit, min, max, step, default: def, interpolable, neutral });

const freq = (label: string, def: number, min = 20, max = 20000) =>
  num(label, "Hz", min, max, 1, def, false);

const slope = {
  kind: "enum",
  label: "Inclinação",
  options: [
    { value: "6", label: "6 dB/oct" },
    { value: "12", label: "12 dB/oct" },
    { value: "18", label: "18 dB/oct" },
    { value: "24", label: "24 dB/oct" },
  ],
  default: "12",
} as const satisfies ParamSpec;

export const MODULES = {
  gain: {
    label: "Ganho",
    description: "Ajusta o volume.",
    params: { gain_db: num("Ganho", "dB", -24, 24, 0.1, 0, true, 0) },
  },
  highpass: {
    label: "Filtro passa-altas",
    description: "Remove graves indesejados.",
    params: { frequency_hz: freq("Frequência", 80, 10, 2000), slope_db_oct: slope },
  },
  lowpass: {
    label: "Filtro passa-baixas",
    description: "Suaviza agudos excessivos.",
    params: { frequency_hz: freq("Frequência", 16000, 500, 20000), slope_db_oct: slope },
  },
  eq_peak: {
    label: "EQ paramétrico",
    description: "Realça ou atenua uma região do som.",
    params: {
      frequency_hz: freq("Frequência", 1000),
      gain_db: num("Ganho", "dB", -18, 18, 0.1, 0, true, 0),
      q: num("Q", undefined, 0.1, 18, 0.01, 1, false),
    },
  },
  eq_shelf: {
    label: "EQ shelving",
    description: "Ajusta graves ou agudos de forma ampla.",
    params: {
      position: {
        kind: "enum",
        label: "Tipo",
        options: [
          { value: "low", label: "Graves (low shelf)" },
          { value: "high", label: "Agudos (high shelf)" },
        ],
        default: "high",
      },
      frequency_hz: freq("Frequência", 8000),
      gain_db: num("Ganho", "dB", -18, 18, 0.1, 0, true, 0),
      q: num("Q", undefined, 0.3, 2, 0.01, 0.707, false),
    },
  },
  compressor: {
    label: "Compressor",
    description: "Controla a dinâmica.",
    params: {
      threshold_db: num("Threshold", "dB", -60, 0, 0.1, -18, true, 0),
      ratio: num("Ratio", ":1", 1, 20, 0.1, 3, true, 1),
      attack_ms: num("Attack", "ms", 0.1, 300, 0.1, 10, false),
      release_ms: num("Release", "ms", 5, 2000, 1, 120, false),
      knee_db: num("Knee", "dB", 0, 24, 0.5, 6, false),
      makeup_db: num("Makeup", "dB", -12, 24, 0.1, 0, true, 0),
    },
  },
  limiter: {
    label: "Limiter",
    description: "Evita picos e aumenta o volume percebido.",
    params: {
      ceiling_db: num("Teto", "dBFS", -12, 0, 0.1, -1, false),
      input_gain_db: num("Ganho de entrada", "dB", 0, 24, 0.1, 0, true, 0),
      release_ms: num("Release", "ms", 1, 1000, 1, 60, false),
      lookahead_ms: num("Lookahead", "ms", 0, 10, 0.1, 5, false),
    },
  },
  gate: {
    label: "Gate / Expander",
    description: "Reduz ruído e vazamento entre as notas.",
    params: {
      threshold_db: num("Threshold", "dB", -90, 0, 0.1, -50, true, -90),
      range_db: num("Atenuação máxima", "dB", 0, 90, 0.5, 30, true, 0),
      ratio: num("Ratio (expander)", ":1", 1, 20, 0.1, 4, false),
      attack_ms: num("Attack", "ms", 0.1, 100, 0.1, 1, false),
      hold_ms: num("Hold", "ms", 0, 500, 1, 20, false),
      release_ms: num("Release", "ms", 5, 2000, 1, 100, false),
    },
  },
  saturation: {
    label: "Saturação",
    description: "Adiciona calor e harmônicos.",
    params: {
      mode: {
        kind: "enum",
        label: "Caráter",
        options: [
          { value: "tape", label: "Fita (suave)" },
          { value: "tube", label: "Válvula (assimétrica)" },
          { value: "hard", label: "Dura" },
        ],
        default: "tape",
      },
      drive_db: num("Drive", "dB", 0, 36, 0.1, 6, true, 0),
      mix: num("Mix", "%", 0, 100, 1, 100, true, 0),
      output_db: num("Saída", "dB", -24, 12, 0.1, 0, false),
    },
  },
  soft_clip: {
    label: "Soft clipper",
    description: "Arredonda os picos mais altos.",
    params: {
      ceiling_db: num("Teto", "dBFS", -12, 0, 0.1, -0.3, false),
      input_gain_db: num("Ganho de entrada", "dB", 0, 18, 0.1, 0, true, 0),
    },
  },
  stereo_width: {
    label: "Largura estéreo",
    description: "Abre ou fecha a imagem estéreo.",
    params: {
      width: num("Largura", "%", 0, 200, 1, 100, true, 100),
      bass_mono_hz: num("Graves em mono abaixo de", "Hz", 0, 300, 1, 0, false),
    },
  },
  delay: {
    label: "Delay",
    description: "Adiciona repetições.",
    params: {
      time_ms: num("Tempo", "ms", 1, 2000, 1, 250, false),
      feedback: num("Feedback", "%", 0, 95, 1, 25, false),
      lowpass_hz: freq("Filtro das repetições", 8000, 500, 20000),
      mix: num("Mix", "%", 0, 100, 1, 15, true, 0),
    },
  },
  reverb: {
    label: "Reverb",
    description: "Adiciona ambiência.",
    params: {
      room_size: num("Tamanho", "%", 0, 100, 1, 50, false),
      damping: num("Amortecimento", "%", 0, 100, 1, 50, false),
      width: num("Largura", "%", 0, 100, 1, 100, false),
      predelay_ms: num("Pré-delay", "ms", 0, 200, 1, 10, false),
      mix: num("Mix", "%", 0, 100, 1, 15, true, 0),
    },
  },
  normalize: {
    label: "Normalização",
    description: "Ajusta o volume para um alvo.",
    params: {
      mode: {
        kind: "enum",
        label: "Modo",
        options: [
          { value: "peak", label: "Pico (dBFS)" },
          { value: "lufs", label: "Loudness (LUFS integrado)" },
        ],
        default: "lufs",
      },
      target_db: num("Alvo", "dB", -40, 0, 0.1, -14, false),
    },
  },
  amp: {
    label: "Amplificador",
    description: "Simula amplificador e caixa para guitarra ou baixo ligados direto (interface, pedaleira ou cabo).",
    params: {
      model: {
        kind: "enum",
        label: "Amplificador",
        options: AMP_MODELS.map(({ value, label }) => ({ value, label })),
        default: "clean_us",
      },
      gain: num("Ganho", undefined, 0, 10, 0.1, 5, true, 0),
      bass: num("Graves", undefined, 0, 10, 0.1, 5, false),
      mid: num("Médios", undefined, 0, 10, 0.1, 5, false),
      treble: num("Agudos", undefined, 0, 10, 0.1, 5, false),
      presence: num("Presença", undefined, 0, 10, 0.1, 5, false),
      cabinet: { kind: "enum", label: "Caixa", options: CABINETS, default: "auto" },
      ir: sample("Caixa gravada (IR)", "ir"),
      blend: num("Amp x linha", "%", 0, 100, 1, 100, true, 0),
      level_db: num("Volume", "dB", -12, 12, 0.1, 0, false),
    },
  },
  overdrive: {
    label: "Pedal overdrive",
    description: "Drive de pedal antes do amplificador: aperta o grave e empurra os médios.",
    params: {
      drive: num("Drive", undefined, 0, 10, 0.1, 4, true, 0),
      tone: num("Tone", undefined, 0, 10, 0.1, 5, false),
      level_db: num("Volume", "dB", -12, 12, 0.1, 0, false),
    },
  },
  chorus: {
    label: "Pedal chorus",
    description: "Dobra o som com leve variação de afinação: guitarra mais larga e brilhante.",
    params: {
      rate_hz: num("Velocidade", "Hz", 0.1, 5, 0.05, 0.8, false),
      depth: num("Profundidade", "%", 0, 100, 1, 40, false),
      mix: num("Mix", "%", 0, 100, 1, 40, true, 0),
    },
  },
  octaver: {
    label: "Pedal oitavador",
    description: "Soma uma oitava abaixo: baixo mais gordo ou guitarra com peso de baixo.",
    params: {
      octave: num("Oitava abaixo", "%", 0, 100, 1, 60, true, 0),
      dry: num("Som original", "%", 0, 100, 1, 100, false),
      tone_hz: num("Tom da oitava", "Hz", 100, 2000, 1, 500, false),
    },
  },
  drum_studio: {
    label: "Bateria de estúdio",
    description: "Identifica bumbo, caixa, tons e surdo e reforça cada batida com samples de bateria de estúdio.",
    params: {
      kit: {
        kind: "enum",
        label: "Timbre",
        options: [
          { value: "worship", label: "Worship" },
          { value: "poprock", label: "Pop Rock" },
          { value: "reggae", label: "Reggae" },
          { value: "groove", label: "Groove / Funk" },
          { value: "soul", label: "Soul / R&B" },
          { value: "gospel", label: "Gospel" },
          { value: "sertanejo", label: "Sertanejo" },
        ],
        default: "poprock",
      },
      sample_mix: num("Som de estúdio", "%", 0, 100, 1, 60, true, 0),
      kick_sample: sample("Bumbo", "kick"),
      snare_sample: sample("Caixa", "snare"),
      tom1_sample: sample("Tom 1", "tom"),
      tom2_sample: sample("Tom 2", "tom"),
      floor_sample: sample("Surdo", "floor"),
      rimshot_sample: sample("Caixa com aro", "rimshot"),
      kick: num("Volume do bumbo", "dB", -12, 12, 0.5, 0, false),
      snare: num("Volume da caixa", "dB", -12, 12, 0.5, 0, false),
      toms: num("Volume dos tons", "dB", -12, 12, 0.5, 0, false),
      floor: num("Volume do surdo", "dB", -12, 12, 0.5, 0, false),
      // detecção: 50 = automático (calibrado pelo próprio arquivo)
      kick_sens: num("Sensibilidade do bumbo", "%", 0, 100, 1, 50, false),
      snare_sens: num("Sensibilidade da caixa", "%", 0, 100, 1, 50, false),
      tom_sens: num("Sensibilidade dos tons e surdo", "%", 0, 100, 1, 50, false),
      kick_tune: tune("Afinação do bumbo"),
      snare_tune: tune("Afinação da caixa"),
      toms_tune: tune("Afinação dos tons"),
      floor_tune: tune("Afinação do surdo"),
      /** Parte das caixas mais fortes que vira rimshot (0 = nunca). */
      rimshot: num("Caixas fortes com aro", "%", 0, 100, 5, 0, false),
      /** Microfones de sala gravados junto com os samples. */
      room: num("Microfones de sala", "%", 0, 100, 1, 40, true, 0),
      reverb_size: {
        kind: "enum",
        label: "Reverb",
        options: [
          { value: "small", label: "Small" },
          { value: "medium", label: "Médio" },
          { value: "large", label: "Large" },
        ],
        default: "medium",
      },
      reverb: num("Quantidade de reverb", "%", 0, 100, 1, 25, true, 0),
    },
  },
} as const satisfies Record<string, ModuleSpec>;

export type ModuleType = keyof typeof MODULES;
export const MODULE_TYPES = Object.keys(MODULES) as ModuleType[];
