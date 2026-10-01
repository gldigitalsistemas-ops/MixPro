"use client";

/**
 * Celular/tablet: o navegador tem bem menos memória disponível por aba (o iPhone fecha a página
 * perto de 1 GB). Usado para escolher modelos e limites mais leves.
 */
export function isPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPad com iPadOS se apresenta como Mac, mas tem tela de toque
  const ipadOs = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  return ipadOs || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}
