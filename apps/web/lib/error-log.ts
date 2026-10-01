"use client";

/**
 * Registro de erros para a aba "Logs" do admin.
 *
 * - reportError: grava um erro com navegador, sistema, etapa, contexto do arquivo e a causa provável.
 * - beginTask: marca uma tarefa pesada em andamento (abrir arquivo, prévia, legendas, exportar).
 *   Se o navegador fechar a página no meio dela (o iPhone faz isso sem aviso quando falta memória),
 *   nenhum erro chega a acontecer; a marca fica salva e a queda é registrada quando o usuário volta.
 * Nunca atrapalha o usuário: qualquer falha aqui é ignorada.
 */
import { supabaseBrowser } from "@/lib/supabase/client";

export type Severity = "erro" | "queda" | "aviso";
type Context = Record<string, string | number | boolean | null | undefined>;

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const CLIENT_KEY = "mixpro.cid";
const TASKS_KEY = "mixpro.tasks";
const QUEUE_KEY = "mixpro.error-queue";
const MAX_PER_FINGERPRINT = 3;

// ------------------------------------------------------------------ ambiente

export type Env = { browser: string; os: string; device: string; inApp: string | null };

/** Navegador, sistema e aparelho a partir do user agent (no iPhone todo navegador usa o motor do Safari). */
export function detectEnv(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): Env {
  const touchMac = typeof navigator !== "undefined" && /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || touchMac;
  const android = /Android/.test(ua);
  const v = (re: RegExp) => ua.match(re)?.[1]?.split(".")[0] ?? "";

  const inApp = /Instagram/.test(ua)
    ? "Instagram"
    : /FBAN|FBAV|FB_IAB/.test(ua)
      ? "Facebook"
      : /musical_ly|BytedanceWebview|TikTok/i.test(ua)
        ? "TikTok"
        : /WhatsApp/.test(ua)
          ? "WhatsApp"
          : /GSA\//.test(ua)
            ? "App do Google"
            : android && /; wv\)/.test(ua)
              ? "app (WebView)"
              : null;

  let browser: string;
  if (inApp) browser = `Navegador do ${inApp}`;
  else if (ios) {
    browser = /CriOS/.test(ua)
      ? `Chrome ${v(/CriOS\/([\d.]+)/)}`
      : /FxiOS/.test(ua)
        ? `Firefox ${v(/FxiOS\/([\d.]+)/)}`
        : /EdgiOS/.test(ua)
          ? `Edge ${v(/EdgiOS\/([\d.]+)/)}`
          : /OPiOS|OPT\//.test(ua)
            ? "Opera"
            : `Safari ${v(/Version\/([\d.]+)/)}`;
    browser += " (motor Safari)";
  } else if (/SamsungBrowser/.test(ua)) browser = `Samsung Internet ${v(/SamsungBrowser\/([\d.]+)/)}`;
  else if (/EdgA?\//.test(ua)) browser = `Edge ${v(/EdgA?\/([\d.]+)/)}`;
  else if (/OPR\//.test(ua)) browser = `Opera ${v(/OPR\/([\d.]+)/)}`;
  else if (/Firefox\//.test(ua)) browser = `Firefox ${v(/Firefox\/([\d.]+)/)}`;
  else if (/Chrome\//.test(ua)) browser = `Chrome ${v(/Chrome\/([\d.]+)/)}`;
  else if (/Safari\//.test(ua)) browser = `Safari ${v(/Version\/([\d.]+)/)}`;
  else browser = "Outro";

  const os = ios
    ? `iOS ${(ua.match(/OS (\d+)[_.](\d+)/) ?? []).slice(1, 3).join(".") || (touchMac ? "(iPad)" : "")}`.trim()
    : android
      ? `Android ${v(/Android ([\d.]+)/)}`
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Outro";

  let device = ios ? (/iPad/.test(ua) || touchMac ? "iPad" : "iPhone") : android ? (ua.match(/Android [\d.]+; ([^;)]+)/)?.[1]?.trim() ?? "Android") : "Computador";
  if (device === "K") device = "Android";
  return { browser, os, device, inApp };
}

/** Memória e recursos do aparelho (ajudam a achar a causa). */
function deviceInfo(): Context {
  if (typeof navigator === "undefined") return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
  return {
    ram_gb: nav.deviceMemory,
    cpus: nav.hardwareConcurrency,
    heap_mb: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1e6) : undefined,
    heap_limite_mb: perf.memory ? Math.round(perf.memory.jsHeapSizeLimit / 1e6) : undefined,
    tela: `${screen.width}x${screen.height}`,
    instalado: matchMedia?.("(display-mode: standalone)").matches || (nav as Navigator & { standalone?: boolean }).standalone === true,
    online: nav.onLine,
    webcodecs_audio: typeof AudioDecoder !== "undefined",
    webcodecs_video: typeof VideoEncoder !== "undefined",
    minutos_aberto: Math.round(performance.now() / 60000),
  };
}

// ------------------------------------------------------------------ causa provável

const CAUSES: [RegExp, string][] = [
  [/notfounderror|can ?not be found|could not be found|notreadableerror|not readable/i,
    "O sistema apagou a cópia temporária do arquivo escolhido (comum no iPhone ao escolher da Galeria ou com vídeo no iCloud). O app usa a cópia salva no aparelho quando existe; senão pede para escolher de novo."],
  [/out of memory|allocation failed|array buffer allocation|invalid array length|memory access out of bounds|cannot allocate|wasm.*memory|could not allocate/i,
    "Falta de memória no aparelho: arquivo longo/pesado ou muitos apps abertos. Reduzir o uso de memória nessa etapa."],
  [/chunkloaderror|loading chunk|dynamically imported module|importing a module script failed|failed to load module/i,
    "Parte do app não carregou: versão antiga em cache ou internet caiu ao abrir. O app recarrega sozinho na próxima vez."],
  [/quota|exceeded the quota/i, "Armazenamento do navegador cheio (salvar a edição no aparelho). Pouco espaço livre ou modo privado."],
  [/failed to fetch|networkerror|load failed|network request failed|err_internet|err_network|timed? ?out/i,
    "Internet instável ou sem conexão no momento (download do modelo de legenda, samples ou servidor)."],
  [/audiodecoder|audioencoder|videodecoder|videoencoder|webcodecs|offscreencanvas|not supported|notsupportederror|unsupported/i,
    "O navegador não tem um recurso usado nesta etapa (WebCodecs/codec). Comum em navegadores antigos ou dentro de apps (Instagram/TikTok)."],
  [/decode|encodingerror|unable to decode|demux|corrupt/i, "O navegador não conseguiu ler o formato/codec deste arquivo."],
  [/webgl|context lost|contextlost/i, "A aceleração gráfica (WebGL) do aparelho falhou ou foi liberada pelo sistema."],
  [/notallowederror|permission|denied/i, "O navegador bloqueou a ação (permissão negada, download ou compartilhamento bloqueado)."],
  [/securityerror|insecure/i, "Bloqueio de segurança do navegador (modo privado ou navegador dentro de outro app)."],
  [/worker/i, "Falha ao iniciar o processamento em segundo plano (Worker). Pode ser memória ou navegador sem suporte."],
  [/aborterror|aborted|cancel/i, "Ação cancelada (pelo usuário ou porque outra tarefa começou)."],
];

export function probableCause(message: string, area: string, severity: Severity, env = detectEnv()): string {
  if (severity === "queda") {
    return `O navegador fechou a página durante "${area}" sem aviso. Quase sempre é falta de memória no celular${
      env.inApp ? ` (e o navegador do ${env.inApp} tem ainda menos memória)` : ""
    }.`;
  }
  for (const [re, cause] of CAUSES) if (re.test(message)) return cause;
  return "Erro inesperado no código do app: veja a mensagem e os detalhes técnicos.";
}

// ------------------------------------------------------------------ envio

function clientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return (globalThis as { __mixproCid?: string }).__mixproCid ??= `s-${Math.random().toString(36).slice(2, 14)}`;
  }
}

function fingerprint(area: string, message: string): string {
  // sem números, endereços e ids: o mesmo erro em arquivos diferentes vira um grupo só
  const norm = `${area}|${message.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[0-9a-f]{8,}/g, "").replace(/\d+/g, "#").slice(0, 200)}`;
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) h = Math.imul(h ^ norm.charCodeAt(i), 16777619);
  return `${area}-${(h >>> 0).toString(16)}`;
}

let shared: Context = {};
/** Contexto atual (arquivo aberto, preset, aba) que vai junto em qualquer erro. */
export function setErrorContext(ctx: Context) {
  shared = { ...shared, ...ctx };
}

type Payload = Record<string, unknown>;
const sentCount = new Map<string, number>();

async function send(p: Payload): Promise<boolean> {
  try {
    const { error } = await supabaseBrowser().rpc("log_app_error", p);
    return !error;
  } catch {
    return false;
  }
}

function queue(p: Payload) {
  try {
    const list = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Payload[];
    list.push(p);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-10)));
  } catch {}
}

async function flushQueue() {
  let list: Payload[] = [];
  try {
    list = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Payload[];
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    return;
  }
  for (const p of list) if (!(await send(p))) queue(p);
}

function messageOf(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) return { message: `${err.name !== "Error" ? `${err.name}: ` : ""}${err.message}`, stack: err.stack ?? "" };
  if (typeof err === "string") return { message: err, stack: "" };
  try {
    return { message: JSON.stringify(err).slice(0, 300), stack: "" };
  } catch {
    return { message: String(err), stack: "" };
  }
}

export function reportError(area: string, err: unknown, opts: { severity?: Severity; context?: Context } = {}) {
  try {
    const severity = opts.severity ?? "erro";
    const { message, stack } = messageOf(err);
    const fp = fingerprint(area, message);
    const n = sentCount.get(fp) ?? 0;
    if (n >= MAX_PER_FINGERPRINT) return;
    sentCount.set(fp, n + 1);
    const env = detectEnv();
    const p: Payload = {
      p_client_id: clientId(),
      p_severity: severity,
      p_area: area.slice(0, 40),
      p_fingerprint: fp,
      p_message: message.slice(0, 500) || "(sem mensagem)",
      p_cause: probableCause(message, area, severity, env),
      p_stack: stack.slice(0, 4000) || null,
      p_browser: env.browser,
      p_os: env.os,
      p_device: env.device,
      p_build: BUILD.slice(0, 20),
      p_route: location.pathname.slice(0, 120),
      p_context: compact({ ...shared, ...deviceInfo(), ...opts.context }),
    };
    if (process.env.NODE_ENV !== "production") console.warn("[mixpro:erro]", area, message);
    void send(p).then((ok) => !ok && queue(p));
  } catch {
    // o registro de erros nunca pode quebrar o app
  }
}

function compact(ctx: Context): Context {
  const out: Context = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  return out;
}

// ------------------------------------------------------------------ quedas (página fechada pelo navegador)

type Task = { label: string; at: number; build: string; route: string; hidden?: boolean; left?: boolean; ctx: Context };

function readTasks(): Record<string, Task> {
  try {
    return JSON.parse(localStorage.getItem(TASKS_KEY) ?? "{}") as Record<string, Task>;
  } catch {
    return {};
  }
}
function writeTasks(t: Record<string, Task>) {
  try {
    if (Object.keys(t).length) localStorage.setItem(TASKS_KEY, JSON.stringify(t));
    else localStorage.removeItem(TASKS_KEY);
  } catch {}
}

/**
 * Marca uma tarefa pesada em andamento. Devolve a função que encerra a marca (chame sempre, no finally).
 * `id` separa tarefas que podem rodar juntas (ex.: prévia e legendas).
 */
export function beginTask(id: string, label: string, ctx: Context = {}): () => void {
  const tasks = readTasks();
  tasks[id] = { label, at: Date.now(), build: BUILD, route: location.pathname, ctx: compact({ ...shared, ...ctx }) };
  writeTasks(tasks);
  return () => {
    const t = readTasks();
    delete t[id];
    writeTasks(t);
  };
}

/** Atualiza o contexto de uma tarefa em andamento (ex.: em qual passo ela está). */
export function updateTask(id: string, ctx: Context) {
  const t = readTasks();
  if (!t[id]) return;
  t[id] = { ...t[id], ctx: { ...t[id].ctx, ...compact(ctx) } };
  writeTasks(t);
}

function markAll(patch: Partial<Task>) {
  const t = readTasks();
  if (!Object.keys(t).length) return;
  for (const k of Object.keys(t)) t[k] = { ...t[k], ...patch };
  writeTasks(t);
}

/** Ao abrir o app: tarefa que ficou marcada = a página caiu no meio dela. */
function reportPreviousCrash() {
  const tasks = readTasks();
  writeTasks({});
  for (const t of Object.values(tasks)) {
    // fechou a aba / atualizou de propósito, ou é muito antigo: não é queda
    if (t.left || Date.now() - t.at > 6 * 3600_000) continue;
    reportError(t.label, `A página fechou durante "${t.label}"${t.hidden ? " (o app estava em segundo plano)" : ""}`, {
      severity: "queda",
      context: { ...t.ctx, segundos_na_tarefa: Math.round((Date.now() - t.at) / 1000), versao_da_queda: t.build },
    });
  }
}

const NOISE = /ResizeObserver loop|chrome-extension:|moz-extension:|safari-(web-)?extension:|^Script error\.?$|NEXT_REDIRECT|NEXT_NOT_FOUND/i;

let installed = false;
/** Liga o registro global (uma vez, no layout). */
export function installErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  reportPreviousCrash();
  void flushQueue();

  window.addEventListener("error", (e) => {
    const msg = String(e.message ?? "");
    if (NOISE.test(msg) || NOISE.test(e.filename ?? "")) return;
    reportError("app", e.error ?? msg, { context: { arquivo_js: (e.filename ?? "").split("/").pop(), linha: e.lineno } });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as Error | undefined;
    const msg = String(r?.message ?? r ?? "");
    if (NOISE.test(msg) || r?.name === "AbortError") return;
    reportError("app", r ?? msg);
  });
  // saiu da página de propósito (fechou, atualizou, navegou): a tarefa interrompida não é queda
  window.addEventListener("pagehide", () => markAll({ left: true }));
  document.addEventListener("visibilitychange", () => markAll({ hidden: document.visibilityState === "hidden" }));
}
