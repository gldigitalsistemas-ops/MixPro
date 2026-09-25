"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function RedownloadButton({ fileId }: { fileId: string }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        const r = await fetch(`/api/downloads/${fileId}`, { method: "POST" });
        const body = await r.json();
        setLoading(false);
        if (!r.ok) return toast.error(body.error ?? "Não foi possível baixar.");
        window.location.href = body.url;
      }}
    >
      <Download className="size-4" aria-hidden /> Baixar de novo
    </Button>
  );
}
