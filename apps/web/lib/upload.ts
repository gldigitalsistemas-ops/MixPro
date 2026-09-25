"use client";

/** Envia um arquivo em 3 passos: pedir URL assinada → PUT direto no storage → confirmar. */
export async function uploadAudio(
  file: File,
  target: { project_id: string; track_id?: string },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ file_id: string }> {
  const start = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, file_name: file.name, size_bytes: file.size }),
  });
  const init = await start.json();
  if (!start.ok) throw new Error(init.error ?? "Não foi possível iniciar o envio.");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", init.upload_url);
    xhr.setRequestHeader("Content-Type", init.content_type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Falha no envio do arquivo.")));
    xhr.onerror = () => reject(new Error("Falha de conexão durante o envio."));
    xhr.onabort = () => reject(new Error("Envio cancelado."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });

  const done = await fetch(`/api/uploads/${init.file_id}/complete`, { method: "POST" });
  const body = await done.json();
  if (!done.ok) throw new Error(body.error ?? "Não foi possível confirmar o envio.");
  return { file_id: init.file_id };
}

export function validateFile(file: File, allowed: string[], maxMb: number): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!allowed.includes(ext)) return `Formato não suportado. Envie ${allowed.map((a) => a.toUpperCase()).join(", ")}.`;
  if (file.size > maxMb * 1024 * 1024) return `Este arquivo ultrapassa o limite de ${maxMb} MB.`;
  if (file.size === 0) return "O arquivo está vazio.";
  return null;
}
