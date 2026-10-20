/**
 * Teste do Modo Cover no navegador (Chrome de verdade), sem câmera: cria um VS de teste no aparelho (bateria e
 * instrumentos sintéticos), envia um vídeo em que a mesma bateria começa 3,2 s depois do início da gravação, confere
 * a sincronia e gera o MP4 final.
 *
 *   pnpm build && pnpm start &
 *   BASE_URL=http://localhost:3000 FFMPEG=ffmpeg node e2e/cover-check.mjs
 */
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const OFFSET = 3.2;

/** Bateria sintética determinística (a mesma "partitura" no VS e no vídeo; no vídeo, com variação humana). */
const GROOVE = `(sr, seconds, startS, jitterMs, total) => {
  const n = Math.round(total * sr);
  const x = new Float32Array(n);
  let r = 4.5;
  const rnd = () => (r = Math.abs(Math.sin(r * 12.9898 + 78.233) * 43758.5453) % 1);
  let p = 7.5;
  const score = () => (p = Math.abs(Math.sin(p * 91.7 + 3.1) * 9137.13) % 1);
  const beat = 60 / 116;
  const hit = (t, f, amp, decay) => {
    const s0 = Math.round((startS + t) * sr);
    for (let k = 0; k < sr * 0.25 && s0 + k < n; k++) {
      if (s0 + k < 0) continue;
      const env = Math.exp(-k / (sr * decay));
      x[s0 + k] += amp * env * (f > 0 ? Math.sin((2 * Math.PI * f * k) / sr) : rnd() * 2 - 1);
    }
  };
  for (let b = 0; b * beat < seconds; b++) {
    const t = b * beat;
    const j = () => (jitterMs / 1000) * (rnd() * 2 - 1);
    if (b % 2 === 0 || score() > 0.8) hit(t + j(), 60, 0.8, 0.06);
    if (b % 2 === 1) hit(t + j(), 0, 0.5, 0.04);
    hit(t + j(), 0, 0.15, 0.01);
    if (score() > 0.7) hit(t + beat / 2 + j(), 0, 0.12, 0.01);
    if (b % 16 === 15) for (let k = 1; k < 4; k++) hit(t + (k * beat) / 4 + j(), 180 - k * 30, 0.5, 0.08);
  }
  return x;
}`;
const groove = eval(GROOVE);

// vídeo: 720x1280, a bateria entra em 3,2 s (o resto é o "ambiente")
const dir = mkdtempSync(join(tmpdir(), "cover-e2e-"));
const sr = 48000;
const audio = groove(sr, 30, OFFSET, 6, 36);
const wav = Buffer.alloc(44 + audio.length * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + audio.length * 2, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sr, 24);
wav.writeUInt32LE(sr * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(audio.length * 2, 40);
for (let i = 0; i < audio.length; i++) wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(audio[i] * 30000 + (Math.random() - 0.5) * 300))), 44 + i * 2);
writeFileSync(join(dir, "a.wav"), wav);
const mp4 = join(dir, "meu-cover.mp4");
const ff = spawnSync(FFMPEG, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=30", "-i", join(dir, "a.wav"), "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", mp4]);
if (ff.status !== 0) throw new Error(String(ff.stderr));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR", serviceWorkers: "block", acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/cover`, { waitUntil: "networkidle" });

// VS de teste no aparelho: bateria = a mesma partitura; "other" = acordes; baixo e voz em silêncio
await page.evaluate(async (src) => {
  const groove = eval(src);
  const SR = 44100;
  const len = SR * 30;
  const drums = groove(SR, 30, 0, 0, 30);
  const toI16 = (f) => Int16Array.from(f, (v) => Math.max(-32767, Math.min(32767, Math.round(v * 30000))));
  const d = toI16(drums);
  const other = new Int16Array(len);
  for (let i = 0; i < len; i++) other[i] = Math.round(4000 * Math.sin((2 * Math.PI * 220 * i) / SR) + 3000 * Math.sin((2 * Math.PI * 277 * i) / SR));
  const zero = new Int16Array(len);
  const beats = [];
  for (let t = 0; t < 30; t += 60 / 116) beats.push(t);
  const rec = { name: "Música de teste", key: "teste", savedAt: Date.now(), sampleRate: SR, beats: { bpm: 116, beats, downbeat: 0 }, stems: [[d, d], [zero, zero], [other, other], [zero, zero]] };
  await new Promise((resolve, reject) => {
    const req = indexedDB.open("mixpro-vs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("vs");
    req.onsuccess = () => {
      const tx = req.result.transaction("vs", "readwrite");
      tx.objectStore("vs").put(rec, "last");
      tx.objectStore("vs").put({ name: rec.name, savedAt: rec.savedAt }, "meta");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}, GROOVE);
await page.reload({ waitUntil: "networkidle" });
await page.getByText("1. Música: Música de teste").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Continuar" }).click();
await page.getByRole("button", { name: /Enviar vídeo já gravado/ }).click();
const chooser = page.waitForEvent("filechooser");
await page.getByRole("button", { name: /Escolher o vídeo/ }).click();
await (await chooser).setFiles(mp4);
await page.getByText("3. Ajuste e gere o vídeo").waitFor({ timeout: 180000 });
const syncText = await page.getByText(/Sincroniz|sincronia/).first().innerText();
console.log("sincronia:", syncText);
await page.getByRole("button", { name: "Gerar o vídeo para o Instagram" }).click();
await page.getByRole("link", { name: /Baixar o vídeo/ }).waitFor({ timeout: 180000 });
const download = page.waitForEvent("download");
await page.getByRole("link", { name: /Baixar o vídeo/ }).click();
const out = join(dir, "saida.mp4");
await (await download).saveAs(out);
const probe = spawnSync(FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace("ffmpeg", "ffprobe")), ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,sample_rate", "-of", "csv=p=0", out]);
console.log("saída:", String(probe.stdout).trim().replace(/\r?\n/g, " | "), `${(readFileSync(out).length / 1e6).toFixed(1)} MB`);
console.log(errors.length ? `erros na página: ${errors.join(" / ")}` : "sem erros na página");
await browser.close();
console.log("arquivos:", dir);
