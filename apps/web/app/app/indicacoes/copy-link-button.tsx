"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button size="sm" variant="ghost" onClick={handleCopy} aria-label="Copiar link">
      {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
      {copied ? "Copiado!" : "Copiar"}
    </Button>
  );
}
