"use client";

/**
 * Baixa a partir do arquivo em memória, com um link novo a cada clique (um link antigo pode ter
 * sido liberado pelo navegador depois de muita memória em uso, e aí o download sai vazio).
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
