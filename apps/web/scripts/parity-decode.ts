/**
 * Fatia 2 da Etapa 4: paridade da DECODIFICAÇÃO entre o app (Chrome no computador, lib/media/load.ts
 * sem nenhuma alteração) e o servidor (FFmpeg nativo, lib/export/ffmpeg-decode.ts).
 *
 * Entradas (automático, sem mudar código):
 *  - apps/web/fixtures-local/*  (mídia pessoal; pasta no .gitignore, NUNCA versionar nem enviar)
 *  - apps/web/lib/dsp/fixtures/*.wav
 *  - WAVs sintéticos gerados em .cache/decode-parity/synth
 *
 * Uso (de apps/web):
 *   FFMPEG_PATH=... FFPROBE_PATH=... [CHROME_PATH=...] \
 *   ../../packages/contracts/node_modules/.bin/tsx scripts/parity-decode.ts
 * Saída: tabela por arquivo, cobertura por formato (COBERTO/PENDENTE) e .cache/decode-parity/resultado.json.
 * Nada sai desta máquina: o Chrome abre só http://127.0.0.1 e os arquivos são lidos do disco.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { integratedLoudness, samplePeak } from "@/lib/dsp/loudness";
import type { Signal } from "@/lib/dsp/types";
import { decodeMedia, DecodeError } from "@/lib/export/ffmpeg-decode";
import { SYNTH_WAVS, synthWav } from "@/lib/export/synth-wav";

const WEB = resolve(".");
const OUT = join(WEB, ".cache/decode-parity");
const SYNTH = join(OUT, "synth");
const LOCAL = join(WEB, "fixtures-local");
/** AAC/MP3 sintéticos versionados (ruído e tons, nada pessoal): picos acima de 1 e atraso do LAME. */
const REPO_SYNTH = join(WEB, "lib/export/fixtures/decode");
const REFERENCE = join(WEB, "lib/export/fixtures/decode-reference.json");
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const CHROME =
  process.env.CHROME_PATH ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p));
/** O app no computador aceita até 15 min [lib/media/load.ts]. */
const MAX_S = 15 * 60;
const MEDIA = /\.(mov|mp4|m4a|m4v|mp3|wav|flac|ogg|opus|oga|webm|aac|caf|aif|aiff)$/i;

// ------------------------------------------------------------------ WAVs sintéticos

// ------------------------------------------------------------------ classificação (cobertura)

type Probe = { streams?: { codec_type: string; codec_name?: string; sample_rate?: string; channels?: number; bits_per_raw_sample?: string; sample_fmt?: string; disposition?: { attached_pic?: number } }[]; format?: { format_name?: string; tags?: Record<string, string> } };

function probe(path: string): Probe {
  const r = spawnSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return {};
  }
}

/** MP3 VBR tem cabeçalho "Xing" no primeiro quadro; CBR tem "Info" ou nada. */
function mp3IsVbr(path: string) {
  const head = readFileSync(path).subarray(0, 256 * 1024);
  return head.includes(Buffer.from("Xing")) || head.includes(Buffer.from("VBRI"));
}

const CATEGORIES = [
  "WAV 16 bits 44,1 kHz",
  "WAV 16 bits 48 kHz",
  "WAV 24 bits",
  "WAV float 32",
  "WAV taxa baixa (≤ 24 kHz)",
  "WAV estéreo com canais idênticos → mono",
  "Áudio < 0,5 s → recusado",
  "MOV do iPhone (câmera, AAC)",
  "MP4 de Android (câmera, original)",
  "MP4/AAC compartilhado (WhatsApp/redes)",
  "M4A do Gravador do iPhone",
  "MP3 CBR",
  "MP3 VBR",
  "OGG/Opus (WhatsApp)",
  "FLAC",
  "WAV float com valores acima de 1",
  "AAC com picos acima de 1 (sintético)",
  "AAC sem picos (sintético)",
  "MP3 com picos acima de 1 (sintético)",
  "MP3 com atraso do LAME (sintético)",
] as const;

function categorize(path: string): string[] {
  const name0 = basename(path);
  // sintéticos com perda do repositório: categorias próprias (não contam como formato real)
  if (path.startsWith(REPO_SYNTH)) {
    const out: string[] = [];
    if (name0.startsWith("quente-aac")) out.push("AAC com picos acima de 1 (sintético)");
    if (name0.startsWith("normal-aac")) out.push("AAC sem picos (sintético)");
    if (name0.startsWith("quente-mp3")) out.push("MP3 com picos acima de 1 (sintético)");
    if (name0.includes("lame")) out.push("MP3 com atraso do LAME (sintético)");
    return out;
  }
  if (name0.includes("acima-de-1")) return ["WAV float com valores acima de 1"];
  const p = probe(path);
  const a = p.streams?.find((s) => s.codec_type === "audio");
  const video = p.streams?.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const fmt = p.format?.format_name ?? "";
  const tags = Object.fromEntries(Object.entries(p.format?.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const out: string[] = [];
  const name = basename(path);
  if (!a) return out;
  if (a.codec_name?.startsWith("pcm_") && fmt.includes("wav")) {
    const sr = Number(a.sample_rate);
    const bits = a.codec_name === "pcm_f32le" ? 32 : Number(a.bits_per_raw_sample || a.codec_name.replace(/\D/g, ""));
    if (a.codec_name === "pcm_f32le") out.push("WAV float 32");
    else if (bits === 24) out.push("WAV 24 bits");
    else if (bits === 16 && sr === 44100) out.push("WAV 16 bits 44,1 kHz");
    else if (bits === 16 && sr === 48000) out.push("WAV 16 bits 48 kHz");
    if (sr <= 24000) out.push("WAV taxa baixa (≤ 24 kHz)");
    if (name.includes("identico")) out.push("WAV estéreo com canais idênticos → mono");
    if (name.includes("curto")) out.push("Áudio < 0,5 s → recusado");
  } else if (a.codec_name === "mp3") out.push(mp3IsVbr(path) ? "MP3 VBR" : "MP3 CBR");
  else if (a.codec_name === "opus" || a.codec_name === "vorbis") out.push("OGG/Opus (WhatsApp)");
  else if (a.codec_name === "flac") out.push("FLAC");
  else if (fmt.includes("mp4") || fmt.includes("mov")) {
    const apple = (tags["com.apple.quicktime.make"] ?? "").toLowerCase() === "apple";
    if (video && apple) out.push("MOV do iPhone (câmera, AAC)");
    else if (video && Object.keys(tags).some((k) => k.startsWith("com.android"))) out.push("MP4 de Android (câmera, original)");
    else if (video) out.push("MP4/AAC compartilhado (WhatsApp/redes)");
    else out.push("M4A do Gravador do iPhone");
  }
  return out;
}

// ------------------------------------------------------------------ lado do navegador (Chrome headless)

const MIME: Record<string, string> = {
  ".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/mp4", ".m4a": "audio/x-m4a", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".flac": "audio/flac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".webm": "video/webm", ".aac": "audio/aac",
  ".caf": "audio/x-caf", ".aif": "audio/aiff", ".aiff": "audio/aiff",
};

type BrowserResult = { error?: string; kind?: string; sampleRate?: number; audioStart?: number; duration?: number; channels?: Signal };

async function decodeInChrome(files: string[]): Promise<BrowserResult[]> {
  if (!CHROME) throw new Error("Chrome não encontrado: defina CHROME_PATH");
  const esbuild = createRequire(createRequire(resolve("../../packages/contracts/package.json")).resolve("tsx/package.json"))("esbuild");
  mkdirSync(OUT, { recursive: true });
  const entry = join(OUT, "entry.ts");
  writeFileSync(
    entry,
    `import { loadMedia } from "@/lib/media/load";
(async () => {
  const list: { name: string; type: string }[] = await (await fetch("/list")).json();
  for (let i = 0; i < list.length; i++) {
    try {
      const blob = await (await fetch("/file/" + i)).blob();
      const m = await loadMedia(new File([blob], list[i].name, { type: list[i].type }), () => {});
      const meta = new TextEncoder().encode(JSON.stringify({ kind: m.kind, sampleRate: m.sampleRate, audioStart: m.audioStart, duration: m.duration, n: m.channels.length, len: m.channels[0].length }));
      const head = new Uint32Array([meta.length]);
      await fetch("/result/" + i, { method: "POST", body: new Blob([head, meta, ...m.channels.map((c) => c.slice())]) });
    } catch (e) {
      const meta = new TextEncoder().encode(JSON.stringify({ error: (e && (e as { code?: string }).code) || String(e) }));
      await fetch("/result/" + i, { method: "POST", body: new Blob([new Uint32Array([meta.length]), meta]) });
    }
  }
  await fetch("/done");
})();
`,
  );
  const bundle = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", tsconfig: join(WEB, "tsconfig.json"), logLevel: "error" });
  const js = bundle.outputFiles[0].text;
  const results: BrowserResult[] = files.map(() => ({ error: "sem resposta" }));

  return new Promise((resolveAll, reject) => {
    let chrome: ReturnType<typeof spawn> | null = null;
    const profile = mkdtempSync(join(tmpdir(), "mixpro-decode-"));
    const finish = (err?: Error) => {
      chrome?.kill();
      server.close();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1500);
      if (err) reject(err);
      else resolveAll(results);
    };
    const timer = setTimeout(() => finish(new Error("Chrome não terminou em 20 min")), 20 * 60 * 1000);
    const server = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/") return res.end(`<!doctype html><meta charset=utf-8><script type=module src="/bundle.js"></script>`);
      if (url === "/bundle.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(js);
      if (url === "/list") return res.end(JSON.stringify(files.map((f) => ({ name: basename(f), type: MIME[extname(f).toLowerCase()] ?? "" }))));
      if (url.startsWith("/file/")) return res.end(readFileSync(files[Number(url.slice(6))]));
      if (url.startsWith("/result/")) {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const b = Buffer.concat(chunks);
          const len = b.readUInt32LE(0);
          const meta = JSON.parse(b.subarray(4, 4 + len).toString("utf8"));
          const r: BrowserResult = meta.error ? { error: meta.error } : { ...meta, channels: [] };
          if (!meta.error) {
            const pad = 4 + len;
            const data = new Uint8Array(b.subarray(pad)).slice().buffer;
            for (let c = 0; c < meta.n; c++) r.channels!.push(new Float32Array(data, c * meta.len * 4, meta.len));
          }
          results[Number(url.slice(8))] = r;
          res.end("ok");
        });
        return;
      }
      if (url === "/done") {
        res.end("ok");
        clearTimeout(timer);
        return finish();
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      chrome = spawn(CHROME!, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { stdio: "ignore" });
    });
  });
}

// ------------------------------------------------------------------ comparação

const sha32 = (x: Signal) => {
  const h = createHash("sha256");
  for (const c of x) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
  return h.digest("hex");
};

/** Atraso (amostras) do servidor em relação ao navegador, por correlação numa janela de 0,5 s. */
function lagOf(ref: Float32Array, other: Float32Array, sr: number): number {
  const maxLag = 4096;
  const win = Math.round(sr * 0.5);
  // janela com sinal: o trecho de 0,5 s mais forte entre 10% e 90% do arquivo
  let at = Math.floor(ref.length * 0.1);
  let best = -1;
  for (let s = at; s + win < ref.length * 0.9; s += win) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += ref[i] * ref[i];
    if (e > best) {
      best = e;
      at = s;
    }
  }
  let bestLag = 0;
  let bestC = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = at; i < at + win; i++) {
      const j = i + lag;
      if (j >= 0 && j < other.length) c += ref[i] * other[j];
    }
    if (c > bestC) {
      bestC = c;
      bestLag = lag;
    }
  }
  return bestLag;
}

type Row = {
  arquivo: string;
  origem: "real" | "sintético" | "projeto" | "diagnóstico";
  categorias: string[];
  status: "IDÊNTICO" | "DENTRO" | "DIVERGE" | "AMBOS RECUSAM" | "RECUSA DIFERENTE";
  sha_app?: string;
  detalhe: string;
  navegador?: Record<string, unknown>;
  servidor?: Record<string, unknown>;
  comparacao?: Record<string, number | string>;
};

async function main() {
  mkdirSync(SYNTH, { recursive: true });
  for (const s of SYNTH_WAVS) writeFileSync(join(SYNTH, s.name), synthWav(s));
  const local = existsSync(LOCAL) ? readdirSync(LOCAL).filter((f) => MEDIA.test(f)).map((f) => join(LOCAL, f)) : [];
  const project = readdirSync(join(WEB, "lib/dsp/fixtures")).filter((f) => f.endsWith(".wav")).map((f) => join(WEB, "lib/dsp/fixtures", f));
  const synth = SYNTH_WAVS.map((s) => join(SYNTH, s.name));
  // PARITY_EXTRA=<pasta>: arquivos extras de diagnóstico (ex.: gerados para testar uma hipótese)
  const extraDir = process.env.PARITY_EXTRA;
  const extra = extraDir && existsSync(extraDir) ? readdirSync(extraDir).filter((f) => MEDIA.test(f)).map((f) => join(extraDir, f)) : [];
  const repoSynth = readdirSync(REPO_SYNTH).filter((f) => MEDIA.test(f)).map((f) => join(REPO_SYNTH, f));
  const files = [...local, ...project, ...synth, ...repoSynth, ...extra];
  const origin = (f: string): Row["origem"] =>
    f.startsWith(LOCAL) ? "real" : f.startsWith(SYNTH) || f.startsWith(REPO_SYNTH) ? "sintético" : extra.includes(f) ? "diagnóstico" : "projeto";

  console.log(`arquivos: ${local.length} em fixtures-local, ${project.length} do projeto, ${synth.length} sintéticos`);
  const t0 = Date.now();
  const browser = await decodeInChrome(files);
  console.log(`Chrome: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const rows: Row[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const b = browser[i];
    let s: Awaited<ReturnType<typeof decodeMedia>> | null = null;
    let sErr: string | null = null;
    try {
      s = await decodeMedia(f, { ffmpeg: FFMPEG, ffprobe: FFPROBE, maxDurationS: MAX_S });
    } catch (e) {
      sErr = e instanceof DecodeError ? e.code : String(e);
    }
    const row: Row = { arquivo: basename(f), origem: origin(f), categorias: categorize(f), status: "DIVERGE", detalhe: "" };
    if (b.error || sErr) {
      row.status = b.error && sErr && b.error === sErr ? "AMBOS RECUSAM" : "RECUSA DIFERENTE";
      row.detalhe = `navegador: ${b.error ?? "ok"} · servidor: ${sErr ?? "ok"}`;
      rows.push(row);
      continue;
    }
    const bc = b.channels!;
    // PARITY_DUMP=1: guarda o áudio do navegador (para investigar divergências; fica em .cache, no .gitignore)
    if (process.env.PARITY_DUMP) {
      mkdirSync(join(OUT, "navegador"), { recursive: true });
      writeFileSync(join(OUT, "navegador", `${basename(f)}.f32`), Buffer.concat(bc.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))));
    }
    const sc = s!.channels;
    const sr = s!.sampleRate;
    // sinal periódico engana a correlação: fica com o atraso (achado ou 0) que dá o menor erro
    const errAt = (l: number) => {
      let e = 0;
      for (let k = 0; k < bc[0].length; k++) {
        const j = k + l;
        if (j >= 0 && j < sc[0].length) e += (bc[0][k] - sc[0][j]) ** 2;
      }
      return e;
    };
    const found = lagOf(bc[0], sc[0], sr);
    const lag = found !== 0 && errAt(0) <= errAt(found) ? 0 : found;
    // diferença amostra a amostra depois de alinhar
    let maxDiff = 0;
    let err = 0;
    let ref = 0;
    let n = 0;
    const nch = Math.min(bc.length, sc.length);
    for (let c = 0; c < nch; c++)
      for (let k = 0; k < bc[c].length; k++) {
        const j = k + lag;
        if (j < 0 || j >= sc[c].length) continue;
        const d = bc[c][k] - sc[c][j];
        maxDiff = Math.max(maxDiff, Math.abs(d));
        err += d * d;
        ref += bc[c][k] * bc[c][k];
        n++;
      }
    const compared = n;
    // picos acima de 1 e o resíduo se o servidor limitasse a ±1 (para decidir o limite por formato)
    const over = (x: Signal) => x.reduce((t, ch) => t + ch.reduce((k, v) => k + (Math.abs(v) > 1 ? 1 : 0), 0), 0);
    let errC = 0;
    let maxC = 0;
    for (let c = 0; c < nch; c++)
      for (let k = 0; k < bc[c].length; k++) {
        const j = k + lag;
        if (j < 0 || j >= sc[c].length) continue;
        const d = bc[c][k] - Math.max(-1, Math.min(1, sc[c][j]));
        maxC = Math.max(maxC, Math.abs(d));
        errC += d * d;
      }
    const snrC = errC === 0 ? Infinity : 10 * Math.log10(ref / errC);
    const snr = err === 0 ? Infinity : 10 * Math.log10(ref / err);
    const lb = integratedLoudness(bc, b.sampleRate!);
    const ls = integratedLoudness(sc, sr);
    const lenDiff = sc[0].length - bc[0].length;
    const comp = {
      amostras_comparadas: compared,
      amostras_navegador: bc[0].length,
      amostras_servidor: sc[0].length,
      dif_amostras: lenDiff,
      atraso_amostras: lag,
      canais: `${bc.length}/${sc.length}`,
      taxa: `${b.sampleRate}/${sr}`,
      audio_start: `${(b.audioStart ?? 0).toFixed(6)}/${s!.audioStart.toFixed(6)}`,
      max_dif: maxDiff,
      snr_db: Number.isFinite(snr) ? Number(snr.toFixed(1)) : "∞",
      lufs_dif: Number((ls - lb).toFixed(4)),
      acima_de_1: `${over(bc)}/${over(sc)}`,
      snr_db_se_limitar: Number.isFinite(snrC) ? Number(snrC.toFixed(1)) : "∞",
      max_dif_se_limitar: maxC,
      pico_dif: Number((samplePeak(sc) - samplePeak(bc)).toFixed(6)),
    };
    row.comparacao = comp;
    row.navegador = { kind: b.kind, taxa: b.sampleRate, canais: bc.length, duracao: b.duration, audioStart: b.audioStart };
    row.servidor = { kind: s!.kind, taxa: sr, canais: sc.length, duracao: s!.duration, audioStart: s!.audioStart, codec: s!.codec };
    const sameShape = b.sampleRate === sr && bc.length === sc.length && b.kind === s!.kind && Math.abs((b.audioStart ?? 0) - s!.audioStart) <= 1 / sr;
    if (sameShape && lag === 0 && lenDiff === 0 && maxDiff === 0) row.status = "IDÊNTICO";
    else if (sameShape && lag === 0 && Math.abs(lenDiff) <= 2048 && snr >= 90 && Math.abs(ls - lb) <= 0.01) row.status = "DENTRO";
    else row.status = "DIVERGE";
    row.detalhe = `início app/servidor ${comp.audio_start} s · amostras ${comp.amostras_navegador}/${comp.amostras_servidor} · atraso ${lag} · SNR ${comp.snr_db} dB (máx ${maxDiff.toExponential(1)}) · ΔLUFS ${comp.lufs_dif} · picos>1 app/servidor ${comp.acima_de_1} · se limitar: SNR ${comp.snr_db_se_limitar} dB (máx ${maxC.toExponential(1)}) · ${comp.canais} canais · ${comp.taxa} Hz`;
    row.sha_app = sha32(bc);
    rows.push(row);
  }

  console.log("\narquivo | origem | formato | status | detalhe");
  for (const r of rows) console.log(`${r.arquivo} | ${r.origem} | ${r.categorias.join(", ") || "?"} | ${r.status} | ${r.detalhe}`);
  console.log("\ncobertura por formato:");
  const coverage = CATEGORIES.map((c) => {
    // arquivos de diagnóstico (PARITY_EXTRA) não contam como cobertura
    const hits = rows.filter((r) => r.categorias.includes(c) && r.origem !== "diagnóstico");
    const real = hits.filter((r) => r.origem !== "sintético");
    return { formato: c, situacao: hits.length ? "COBERTO" : "PENDENTE", arquivos: hits.map((r) => `${r.arquivo} (${r.origem}, ${r.status})`), so_sintetico: hits.length > 0 && real.length === 0 };
  });
  for (const c of coverage) console.log(`${c.formato} | ${c.situacao}${c.so_sintetico ? " (só sintético)" : ""} | ${c.arquivos.join("; ") || "falta arquivo"}`);
  // --gravar-referencia: o que o APP (Chrome) obteve, para o CI comparar o servidor sem rodar o Chrome.
  // Só arquivos sintéticos e do repositório (nunca mídia pessoal de fixtures-local).
  if (process.argv.includes("--gravar-referencia")) {
    const ref: Record<string, unknown> = {};
    for (let i = 0; i < files.length; i++) {
      const o = origin(files[i]);
      if (o === "real" || o === "diagnóstico") continue;
      const b = browser[i];
      const key = files[i].startsWith(SYNTH) ? `synth:${basename(files[i])}` : files[i].slice(WEB.length + 1).split(sep).join("/");
      ref[key] = b.error
        ? { erro: b.error }
        : { tipo: b.kind, taxa: b.sampleRate, canais: b.channels!.length, amostras: b.channels![0].length, audio_start: b.audioStart, sha256_f32: sha32(b.channels!), lufs: integratedLoudness(b.channels!, b.sampleRate!), pico: samplePeak(b.channels!) };
    }
    writeFileSync(REFERENCE, JSON.stringify({ origem: "Chrome headless + lib/media/load.ts (app), scripts/parity-decode.ts --gravar-referencia", arquivos: ref }, null, 1) + String.fromCharCode(10));
    console.log(`referência gravada: ${Object.keys(ref).length} arquivos`);
  }
  writeFileSync(join(OUT, "resultado.json"), JSON.stringify({ quando: new Date().toISOString(), ffmpeg: spawnSync(FFMPEG, ["-version"], { encoding: "utf8" }).stdout.split("\n")[0], rows, coverage }, null, 1));
  const bad = rows.filter((r) => r.status === "DIVERGE" || r.status === "RECUSA DIFERENTE");
  if (bad.length) console.log(`\nATENÇÃO: ${bad.length} arquivo(s) divergem: ${bad.map((r) => r.arquivo).join(", ")}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});

