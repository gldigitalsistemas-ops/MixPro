"use client";

/**
 * Mantém a tela acesa durante tarefas longas (gerar vídeo, legendas). Com a tela apagada o
 * celular pausa a página e a tarefa falha. Sem suporte no navegador, não faz nada.
 */
export async function keepAwake(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const lock = await nav.wakeLock?.request("screen");
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}
