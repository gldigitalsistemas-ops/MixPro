/**
 * Teste do gravador do Modo Cover (Chrome com câmera e microfone simulados): abre a câmera, testa o som com o
 * reforço no máximo, grava com contagem, para sozinho no fim da música e chega à etapa de ajuste.
 *
 *   pnpm build && pnpm start &
 *   BASE_URL=http://localhost:3000 node e2e/cover-record-check.mjs
 */
import { chromium } from "playwright-core";
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR", serviceWorkers: "block", permissions: ["camera", "microphone"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
await page.goto(`${BASE}/cover`, { waitUntil: "networkidle" });
// VS curto (12 s) para o teste
await page.evaluate(async () => {
  const SR = 44100, len = SR * 12;
  const d = new Int16Array(len), o = new Int16Array(len), z = new Int16Array(len);
  for (let b = 0; b < 24; b++) { const s0 = Math.round(b * 0.5 * SR); for (let k = 0; k < SR * 0.1; k++) d[s0 + k] = Math.round(20000 * Math.exp(-k / (SR * 0.03)) * Math.sin(k * 0.05)); }
  for (let i = 0; i < len; i++) o[i] = Math.round(5000 * Math.sin((2 * Math.PI * 220 * i) / SR));
  const beats = []; for (let t = 0; t < 12; t += 0.5) beats.push(t);
  const rec = { name: "Teste gravação", key: "t2", savedAt: Date.now(), sampleRate: SR, beats: { bpm: 120, beats, downbeat: 0 }, stems: [[d, d], [z, z], [o, o], [z, z]] };
  await new Promise((res, rej) => { const q = indexedDB.open("mixpro-vs", 1); q.onupgradeneeded = () => q.result.createObjectStore("vs"); q.onsuccess = () => { const tx = q.result.transaction("vs", "readwrite"); tx.objectStore("vs").put(rec, "last"); tx.objectStore("vs").put({ name: rec.name, savedAt: rec.savedAt }, "meta"); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }; });
});
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "Continuar" }).click();
await page.getByText("Toque para abrir a câmera").click({ timeout: 5000 });
await page.getByRole("button", { name: /Testar o som/ }).waitFor();
await page.getByRole("button", { name: /Testar o som/ }).click();
await page.waitForTimeout(1500);
const boost = page.locator('input[type="range"]').first();
await boost.fill("18");
await page.getByRole("button", { name: /Parar o teste/ }).click();
console.log("reforço:", await page.getByText(/\+18 dB/).count() ? "+18 dB aplicado" : "não mudou");
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await page.getByRole("button", { name: /Gravar \(contagem/ }).click();
await page.getByText(/Gravando|Contagem/).first().waitFor({ timeout: 10000 });
console.log("gravando…");
await page.getByText("3. Ajuste e gere o vídeo").waitFor({ timeout: 90000 });
console.log("sincronia:", await page.getByText(/Sincroniz|sincronia/).first().innerText());
const dur = await page.locator("video[controls]").evaluate((v) => new Promise((r) => (v.readyState >= 1 ? r(v.duration) : v.addEventListener("loadedmetadata", () => r(v.duration)))));
console.log("vídeo gravado:", dur, "s");
console.log(errors.length ? "erros: " + errors.join(" / ") : "sem erros na página");
await browser.close();
