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
    };

export type NumberParam = Extract<ParamSpec, { kind: "number" }>;
export type EnumParam = Extract<ParamSpec, { kind: "enum" }>;

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
} as const satisfies Record<string, ModuleSpec>;

export type ModuleType = keyof typeof MODULES;
export const MODULE_TYPES = Object.keys(MODULES) as ModuleType[];
