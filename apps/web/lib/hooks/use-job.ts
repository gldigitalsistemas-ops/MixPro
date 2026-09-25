"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { ProcessingJob } from "@/lib/types";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

type Options = {
  /** Chamado uma vez quando o job termina (concluído, falhou ou cancelado). */
  onSettled?: (job: ProcessingJob) => void;
};

/**
 * Acompanha um job até terminar: Realtime (quando habilitado) + polling de segurança.
 */
export function useJob(jobId: string | null, initial?: ProcessingJob | null, options: Options = {}) {
  const [state, setState] = useState<ProcessingJob | null>(null);
  const onSettled = useRef(options.onSettled);
  useEffect(() => {
    onSettled.current = options.onSettled;
  });

  useEffect(() => {
    if (!jobId) return;
    const supabase = supabaseBrowser();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (row: ProcessingJob) => {
      if (stopped || row.id !== jobId) return;
      setState(row);
      if (TERMINAL.has(row.status)) {
        stopped = true;
        clearTimeout(timer);
        onSettled.current?.(row);
      }
    };

    const poll = async () => {
      const { data } = await supabase.from("processing_jobs").select("*").eq("id", jobId).maybeSingle();
      if (data) apply(data as ProcessingJob);
      if (!stopped) timer = setTimeout(poll, 1200);
    };

    const channel = supabase
      .channel(`job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "processing_jobs", filter: `id=eq.${jobId}` },
        (payload) => apply(payload.new as ProcessingJob),
      )
      .subscribe();

    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [jobId]);

  if (!jobId) return null;
  if (state?.id === jobId) return state;
  return initial?.id === jobId ? initial : null;
}

export function jobIsActive(job: ProcessingJob | null) {
  return !!job && (job.status === "queued" || job.status === "processing");
}
