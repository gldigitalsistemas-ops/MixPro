"use client";

let cached: string | null = null;

/** Família da fonte das legendas (Montserrat, definida no layout como --font-caption). */
export function captionFontFamily(): string {
  if (!cached) {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--font-caption").trim();
    cached = v || "Arial, sans-serif";
  }
  return cached;
}

/** O canvas não espera a fonte carregar: sem isso, os primeiros quadros sairiam com a fonte padrão. */
export async function ensureCaptionFont(): Promise<void> {
  const family = captionFontFamily();
  await Promise.all(["700", "800", "900"].map((w) => document.fonts.load(`${w} 48px ${family}`))).catch(() => {});
}
