"use client";

import { useRef, useState } from "react";
import { CloudUpload, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function UploadDropzone({
  onFile,
  allowed,
  maxMb,
  disabled,
}: {
  onFile: (file: File) => void;
  allowed: string[];
  maxMb: number;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = allowed.map((e) => `.${e}`).join(",") + ",audio/*";

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !disabled) onFile(f);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-12 text-center transition",
          over ? "border-violet-400 bg-primary/10" : "border-white/15 bg-black/15",
        )}
      >
        <CloudUpload className="size-10 text-blue-300" aria-hidden />
        <p className="font-medium">Arraste seu arquivo aqui</p>
        <p className="text-xs text-subtle">ou</p>
        <Button type="button" onClick={() => input.current?.click()} disabled={disabled}>
          Selecionar arquivo
        </Button>
        <input
          ref={input}
          type="file"
          accept={accept}
          className="sr-only"
          aria-label="Selecionar arquivo de áudio"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <p className="text-xs text-subtle">
          Formatos: {allowed.map((a) => a.toUpperCase()).join(", ")} · Tamanho máximo: {maxMb} MB
        </p>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
        Para melhores resultados, envie o arquivo original em WAV, sem compressão ou efeitos já aplicados. O resultado
        depende da qualidade da gravação.
      </p>
    </div>
  );
}
