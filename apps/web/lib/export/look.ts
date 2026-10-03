/** O visual do job como o render espera (puro: serve ao app e ao servidor). */
import type { ExportJob } from "@mixpro/contracts";
import { needsRender, type Look } from "@/lib/media/compose";

/** O Look da composição, a partir do job (mesmos campos que o estúdio monta). */
export function lookOf(job: ExportJob): Look {
  const l = job.look;
  return {
    format: l.format,
    fit: l.fit,
    watermark: l.watermark,
    captions: job.captions ? { ...job.captions, fontFamily: l.font_family } : null,
    fontFamily: l.font_family,
    color: l.color,
    cta: l.cta,
  };
}

/** Recodifica quadro a quadro? (audiograma, antes → depois ou needsRender) */
export function rendersVideo(job: ExportJob): boolean {
  return job.source.media === "audio" || job.look.before_after || needsRender(lookOf(job), job.cuts.applied);
}
