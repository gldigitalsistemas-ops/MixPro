/**
 * Teste de fumaça no navegador (Chrome de verdade, computador e celular): abre as páginas principais, confere o texto
 * essencial, a ausência de erros no console, de rolagem lateral e do contato de suporte; salva capturas de tela.
 *
 *   pnpm build && pnpm start &        (ou use BASE_URL=https://mix-pro-20.vercel.app para testar o site no ar)
 *   node e2e/smoke.mjs
 *
 * Variáveis: BASE_URL (padrão http://localhost:3000), SHOTS (pasta das capturas), CHROME_PATH.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SHOTS = process.env.SHOTS ?? join(process.cwd(), "e2e", "capturas");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(SHOTS, { recursive: true });

const VIEWS = [
  { name: "desktop", viewport: { width: 1280, height: 900 } },
  { name: "celular", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

/** Cada página: o que precisa aparecer (texto) e se exige o botão/rodapé de suporte. */
const PAGES = [
  { path: "/", must: ["Do celular ao", "O que você quer fazer?", "Mix & Master IA", "Perguntas frequentes"], support: true },
  { path: "/producao", must: ["Produção", "Você envia", "Você recebe"], support: true },
  { path: "/mixar", must: ["Mix & Master IA", "Você envia", "Suas pistas", "Perguntas frequentes"], support: true },
  { path: "/produzir", must: ["Produza sua composição", "Sua guia", "Letra da música"], support: true },
  { path: "/vs", must: ["VS"], support: true },
  { path: "/cover", must: ["Grave você tocando", "Primeiro, crie o VS"], support: true },
  { path: "/ferramentas", must: ["Voz + Playback", "Tom e andamento"], support: true },
  { path: "/ajuda", must: ["Ajuda", "FL Studio", "Reaper", "Studio One", "Cubase", "97265-2314"], support: true },
  { path: "/termos", must: ["Termos de uso", "Produção"], support: false },
  { path: "/privacidade", must: ["CPF"], support: false },
  { path: "/ouvir/tokeninvalido123456", must: ["expirou"], support: false },
];

/** Erros do console que não são do app (extensões, bloqueios do navegador). */
const IGNORE = [/Failed to load resource.*(401|403|404)/i, /favicon/i, /ERR_BLOCKED_BY_CLIENT/i, /Download the React DevTools/i];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`   ✗ ${msg}`);
};

for (const view of VIEWS) {
  const ctx = await browser.newContext({ ...view, locale: "pt-BR", serviceWorkers: "block" });
  for (const pg of PAGES) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`exceção: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !IGNORE.some((r) => r.test(m.text())) && errors.push(`console: ${m.text().slice(0, 200)}`));
    console.log(`${view.name} ${pg.path}`);
    try {
      const res = await page.goto(BASE + pg.path, { waitUntil: "networkidle", timeout: 45_000 });
      if (!res || res.status() >= 400) fail(`HTTP ${res?.status()}`);
      const text = await page.locator("body").innerText();
      for (const t of pg.must) if (!text.includes(t)) fail(`não achou o texto “${t}”`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 2) fail(`rolagem lateral de ${overflow}px`);
      // o texto não pode ficar colado na borda da tela (já aconteceu nos Termos, por causa do padding)
      const edge = await page.evaluate(() => {
        const h = document.querySelector("h1");
        const r = h?.getBoundingClientRect();
        return r ? { left: r.left, right: window.innerWidth - r.right } : null;
      });
      if (edge && view.isMobile && (edge.left < 8 || edge.right < 0)) fail(`título colado na borda (esquerda ${Math.round(edge.left)}px)`);
      if (pg.support) {
        const links = await page.locator('a[href*="wa.me/5521972652314"]').count();
        if (!links) fail("sem link de WhatsApp do suporte");
      }
      for (const e of errors) fail(e);
      await page.screenshot({ path: join(SHOTS, `${view.name}${pg.path.replace(/\W+/g, "-") || "-inicio"}.png`), fullPage: false });
    } catch (e) {
      fail(String(e).slice(0, 200));
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} problema(s)` : "\nTudo certo");
process.exit(failures ? 1 : 0);
