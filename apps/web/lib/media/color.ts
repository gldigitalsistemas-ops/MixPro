/**
 * Tratamento de imagem: correção automática (exposição, contraste, balanço de branco, cor) +
 * filtro de estilo, reunidos numa única matriz de cor 3×4 (RGB → RGB + deslocamento).
 * A mesma matriz é usada na prévia (filtro SVG no player) e na exportação (WebGL), então o
 * que a pessoa vê é o que sai no arquivo. Nitidez e vinheta entram só no WebGL (e no quadro de prévia).
 */

/** Linhas R, G, B; colunas r, g, b, deslocamento (valores 0–1). */
export type ColorMatrix = [number, number, number, number, number, number, number, number, number, number, number, number];

export type FilterId = "natural" | "vibrante" | "cinema" | "quente" | "frio" | "vintage" | "pb";

export const FILTERS: { id: FilterId; label: string; hint: string }[] = [
  { id: "natural", label: "Natural", hint: "Só a correção" },
  { id: "vibrante", label: "Vibrante", hint: "Cores vivas" },
  { id: "cinema", label: "Cinema", hint: "Contraste e tom de filme" },
  { id: "quente", label: "Quente", hint: "Pôr do sol" },
  { id: "frio", label: "Frio", hint: "Moderno" },
  { id: "vintage", label: "Vintage", hint: "Desbotado" },
  { id: "pb", label: "P&B", hint: "Preto e branco" },
];

/** Correção calculada a partir de quadros do vídeo. */
export type AutoCorrection = {
  exposure: number; // ganho
  contrast: number; // em torno do cinza médio
  saturation: number;
  wb: [number, number, number]; // ganhos R, G, B (balanço de branco)
  /** O que foi corrigido, em palavras (cartão "Ajuste automático"). */
  notes: string[];
};

export type ColorLook = {
  /** Aplica a correção automática. */
  auto: boolean;
  correction: AutoCorrection | null;
  filter: FilterId;
  /** Força do filtro, 0–100. */
  amount: number;
  /** Nitidez, 0–100. */
  sharpen: number;
  /** Escurecer as bordas, 0–100. */
  vignette: number;
};

export const DEFAULT_LOOK: ColorLook = { auto: true, correction: null, filter: "natural", amount: 100, sharpen: 25, vignette: 0 };

const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

/** a ∘ b: aplica b primeiro, depois a. */
function compose(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out = new Array(12).fill(0) as ColorMatrix;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    }
    out[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return out;
}

const mix = (a: ColorMatrix, b: ColorMatrix, t: number) => a.map((v, i) => v + (b[i] - v) * t) as ColorMatrix;
const gain = (r: number, g: number, b: number): ColorMatrix => [r, 0, 0, 0, 0, g, 0, 0, 0, 0, b, 0];
const contrast = (c: number, pivot = 0.45): ColorMatrix => [c, 0, 0, pivot * (1 - c), 0, c, 0, pivot * (1 - c), 0, 0, c, pivot * (1 - c)];
function saturation(s: number): ColorMatrix {
  const a = (1 - s) * LR;
  const b = (1 - s) * LG;
  const c = (1 - s) * LB;
  return [a + s, b, c, 0, a, b + s, c, 0, a, b, c + s, 0];
}
const lift = (r: number, g: number, b: number): ColorMatrix => [1, 0, 0, r, 0, 1, 0, g, 0, 0, 1, b];

function filterMatrix(id: FilterId): ColorMatrix {
  switch (id) {
    case "vibrante":
      return compose(saturation(1.35), contrast(1.08));
    case "cinema":
      // contraste, cor um pouco contida, sombras puxando para o azul e altas para o laranja
      return compose(lift(-0.015, 0.0, 0.03), compose(gain(1.06, 1.0, 0.93), compose(saturation(0.88), contrast(1.15))));
    case "quente":
      return compose(gain(1.08, 1.02, 0.88), saturation(1.08));
    case "frio":
      return compose(gain(0.93, 1.0, 1.08), saturation(0.95));
    case "vintage":
      return compose(lift(0.05, 0.04, 0.02), compose(gain(1.02, 0.98, 0.86), compose(saturation(0.75), contrast(0.88))));
    case "pb":
      return compose(contrast(1.12), saturation(0));
    default:
      return IDENTITY;
  }
}

/** Matriz final: correção automática e depois o filtro (misturado pela força). */
export function lookMatrix(look: ColorLook): ColorMatrix {
  let m = IDENTITY;
  const c = look.auto ? look.correction : null;
  if (c) m = compose(saturation(c.saturation), compose(contrast(c.contrast), compose(gain(c.exposure, c.exposure, c.exposure), gain(...c.wb))));
  const f = mix(IDENTITY, filterMatrix(look.filter), Math.min(1, Math.max(0, look.amount / 100)));
  return compose(f, m);
}

export const isIdentity = (m: ColorMatrix) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-3);

/** O tratamento muda a imagem? (se não, a exportação pode só copiar o vídeo) */
export function lookIsActive(look: ColorLook | null | undefined): boolean {
  return Boolean(look && (!isIdentity(lookMatrix(look)) || look.sharpen > 0 || look.vignette > 0));
}

/** Valores do feColorMatrix (4×5, com a linha do alfa) para a prévia no player. */
export function svgMatrixValues(m: ColorMatrix): string {
  // feColorMatrix: cada linha é r, g, b, a, deslocamento
  const row = (i: number) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2], 0, m[i * 4 + 3]];
  return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0].map((v) => +v.toFixed(4)).join(" ");
}

// ---------------------------------------------------------------------------
// Correção automática a partir de quadros
// ---------------------------------------------------------------------------

export type FrameStats = { luma: number; std: number; sat: number; r: number; g: number; b: number };

/** Estatísticas de uma imagem pequena (RGBA). */
export function frameStats(data: Uint8ClampedArray): FrameStats {
  let sl = 0;
  let sl2 = 0;
  let ss = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const l = LR * r + LG * g + LB * b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sl += l;
    sl2 += l * l;
    ss += mx > 0 ? (mx - mn) / mx : 0;
    sr += r;
    sg += g;
    sb += b;
  }
  const luma = sl / n;
  return { luma, std: Math.sqrt(Math.max(0, sl2 / n - luma * luma)), sat: ss / n, r: sr / n, g: sg / n, b: sb / n };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Correção suave (nunca "exagerada"): leva o brilho médio para perto de 0,46, abre um pouco o
 * contraste de imagens lavadas, tira parte da dominante de cor (luz amarela/azulada) e dá um
 * pouco de cor em imagens apagadas.
 */
export function autoCorrection(stats: FrameStats[]): AutoCorrection {
  const avg = (k: keyof FrameStats) => stats.reduce((s, f) => s + f[k], 0) / Math.max(1, stats.length);
  const luma = avg("luma");
  const std = avg("std");
  const sat = avg("sat");
  const [r, g, b] = [avg("r"), avg("g"), avg("b")];
  const notes: string[] = [];

  const exposure = clamp(1 + (0.46 / Math.max(luma, 0.05) - 1) * 0.6, 0.85, 1.5);
  if (exposure > 1.08) notes.push("Imagem escura: clareamos");
  else if (exposure < 0.95) notes.push("Imagem estourada: escurecemos um pouco");

  const contrast = clamp(1 + (0.2 / Math.max(std, 0.05) - 1) * 0.35, 0.95, 1.25);
  if (contrast > 1.06) notes.push("mais contraste (imagem lavada)");

  // balanço de branco "mundo cinza", só 60% do caminho (preserva a luz do ambiente)
  const grey = (r + g + b) / 3;
  const wb = [r, g, b].map((c) => clamp(1 + (grey / Math.max(c, 0.02) - 1) * 0.6, 0.88, 1.12)) as [number, number, number];
  if (wb[2] > 1.04 && wb[0] < 0.98) notes.push("tiramos o amarelado da luz");
  else if (wb[0] > 1.04 && wb[2] < 0.98) notes.push("tiramos o azulado da luz");
  else if (Math.abs(wb[1] - 1) > 0.04) notes.push("corrigimos a cor da luz");

  const saturation = sat < 0.22 ? 1.15 : sat < 0.3 ? 1.07 : 1;
  if (saturation > 1.05) notes.push("mais cor");

  return { exposure, contrast, saturation, wb, notes };
}

// ---------------------------------------------------------------------------
// Aplicação com WebGL (exportação e quadro de prévia)
// ---------------------------------------------------------------------------

const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x+1.0)*0.5, 1.0-(p.y+1.0)*0.5); gl_Position = vec4(p,0.0,1.0); }`;
const FRAG = `precision mediump float;
varying vec2 uv; uniform sampler2D img; uniform mat4 m; uniform vec3 off; uniform vec2 px; uniform float sharp; uniform float vig;
void main(){
  vec3 c = texture2D(img, uv).rgb;
  if (sharp > 0.0) {
    vec3 n = texture2D(img, uv + vec2(px.x,0.0)).rgb + texture2D(img, uv - vec2(px.x,0.0)).rgb
           + texture2D(img, uv + vec2(0.0,px.y)).rgb + texture2D(img, uv - vec2(0.0,px.y)).rgb;
    c = c + (c - n * 0.25) * sharp;
  }
  c = (m * vec4(c, 1.0)).rgb + off;
  if (vig > 0.0) { vec2 d = uv - 0.5; c *= 1.0 - vig * smoothstep(0.35, 0.85, length(d) * 1.35); }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

type Canvas = HTMLCanvasElement | OffscreenCanvas;

/** Aplica o tratamento a quadros (reaproveita o contexto WebGL entre quadros). */
export class ColorGrader {
  readonly canvas: Canvas;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;

  private constructor(canvas: Canvas, gl: WebGLRenderingContext, prog: WebGLProgram, tex: WebGLTexture) {
    this.canvas = canvas;
    this.gl = gl;
    this.prog = prog;
    this.tex = tex;
  }

  /** null quando o navegador não tem WebGL (aí o vídeo sai sem o tratamento de imagem). */
  static create(width: number, height: number): ColorGrader | null {
    const canvas: Canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGLRenderingContext | null;
    if (!gl) return null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return new ColorGrader(canvas, gl, prog, tex);
  }

  /** Desenha `src` tratado no canvas do WebGL (mesmo tamanho) e devolve esse canvas. */
  apply(src: TexImageSource, look: ColorLook): Canvas {
    const { gl, prog } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    const m = lookMatrix(look);
    // mat4 do GLSL é por colunas
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, "m"), false, [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]);
    gl.uniform3f(gl.getUniformLocation(prog, "off"), m[3], m[7], m[11]);
    gl.uniform2f(gl.getUniformLocation(prog, "px"), 1 / w, 1 / h);
    gl.uniform1f(gl.getUniformLocation(prog, "sharp"), (look.sharpen / 100) * 0.9);
    gl.uniform1f(gl.getUniformLocation(prog, "vig"), (look.vignette / 100) * 0.55);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  /** Muda o tamanho quando os quadros mudam de tamanho. */
  resize(width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
}
