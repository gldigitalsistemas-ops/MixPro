/**
 * Chaves da exportação: cache do áudio tratado e p_ref do débito de crédito (spend_export_credit).
 * O p_ref NÃO pode mudar: baixar de novo o mesmo resultado não gasta crédito, e quem já baixou
 * seria cobrado outra vez. Código igual ao que ficava no export-panel (testado contra uma cópia).
 */
import { deliverySuffix } from "@mixpro/contracts";
import type { ChainDoc } from "@/lib/dsp/chain";
import { fnvHex } from "@/lib/hash";
import type { Look } from "@/lib/media/compose";
import { lookIsActive, lookMatrix } from "@/lib/media/color";
import type { Segment } from "@/lib/media/cuts";

export type FileLike = { name: string; size: number; lastModified: number };

/** Arquivo do usuário: nome|tamanho|data (o nome só entra dentro do hash). */
export const fileKey = (f: FileLike) => fnvHex(`${f.name}|${f.size}|${f.lastModified}`);

export type AudioRefInput = {
  file: FileLike;
  presetSlug: string;
  intensity: number;
  social: boolean;
  denoise: number;
  chain: ChainDoc;
  /** Destino do ajuste final de volume; sem ele vale o padrão (-14 LUFS, -1 dBFS), que não muda a chave. */
  delivery?: { targetLufs: number; ceilingDb: number };
};

/** O áudio tratado só depende do som. */
export function audioRef(a: AudioRefInput): string {
  return `${fileKey(a.file)}_${a.presetSlug}_${a.intensity}_${a.social ? 1 : 0}${a.social && a.delivery ? deliverySuffix(a.delivery.targetLufs, a.delivery.ceilingDb) : ""}_n${Math.round(a.denoise * 100)}_x${fnvHex(JSON.stringify(a.chain))}`;
}

export type EditRefInput = {
  cutting: boolean;
  segments: Segment[];
  look: Look;
  audiogram: { palette: number; title: string; image: unknown } | null;
  music: { name: string; level: string } | null;
  comparing: boolean;
};

/** O arquivo final depende também de cortes, formato, legendas, música, CTA e cor. */
export function editRef(e: EditRefInput): string {
  const { look, audiogram, music } = e;
  return fnvHex(
    JSON.stringify([
      e.cutting ? e.segments.map((s) => [s.start.toFixed(2), s.end.toFixed(2)]) : 0,
      look.format,
      look.fit,
      look.watermark,
      look.captions ? [look.captions.captions, look.captions.style, look.captions.position] : 0,
      audiogram ? [audiogram.palette, audiogram.title, Boolean(audiogram.image)] : 0,
      music ? [music.name, music.level] : 0,
      e.comparing ? "antes-depois" : 0,
      look.cta ? [look.cta.text, look.cta.handle] : 0,
      lookIsActive(look.color) ? [lookMatrix(look.color!).map((v) => v.toFixed(3)), look.color!.sharpen, look.color!.vignette] : 0,
    ]),
  );
}

/** Chave das configurações (resultado na tela) e p_ref de um alvo. */
export const settingsRef = (audio: string, edit: string) => `${audio}_e${edit}`;
export const resultRef = (settings: string, target: string) => `${settings}_${target}`;
