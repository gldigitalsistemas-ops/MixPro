/**
 * Destinos de loudness do ajuste final. O padrão (`social`) é o valor que o app sempre usou
 * (-14 LUFS, teto -1 dBFS): o p_ref de quem não escolhe outro destino não muda.
 * Os valores são os alvos de cada tipo de uso; o limiter garante o teto de pico.
 */
export const DELIVERY_IDS = ["natural", "podcast", "social", "loud"] as const;
export type DeliveryId = (typeof DELIVERY_IDS)[number];
export const DEFAULT_DELIVERY: DeliveryId = "social";

export type DeliveryTarget = { id: DeliveryId; label: string; description: string; targetLufs: number; ceilingDb: number };

export const DELIVERY_TARGETS: Record<DeliveryId, DeliveryTarget> = {
  natural: {
    id: "natural",
    label: "Natural",
    description: "-18 LUFS: sobe o volume sem esmagar a dinâmica. Bom para música acústica e para quem vai masterizar depois.",
    targetLufs: -18,
    ceilingDb: -1,
  },
  podcast: {
    id: "podcast",
    label: "Podcast e fala",
    description: "-16 LUFS: o padrão de podcast e de aplicativos de áudio falado (Apple Podcasts).",
    targetLufs: -16,
    ceilingDb: -1,
  },
  social: {
    id: "social",
    label: "Redes, YouTube e streaming",
    description: "-14 LUFS: o padrão de Instagram, TikTok, YouTube e Spotify. Seu áudio não fica mais baixo que os outros.",
    targetLufs: -14,
    ceilingDb: -1,
  },
  loud: {
    id: "loud",
    label: "Alto (impacto)",
    description: "-9 LUFS: bem mais forte. As plataformas podem abaixar o volume, mas o som fica mais denso e compacto.",
    targetLufs: -9,
    ceilingDb: -1,
  },
};

export const DELIVERY_LUFS = DELIVERY_IDS.map((id) => DELIVERY_TARGETS[id].targetLufs);

/** Sufixo da chave do áudio tratado: vazio no padrão, para não mudar nenhuma chave existente. */
export function deliverySuffix(targetLufs: number, ceilingDb: number): string {
  const d = DELIVERY_TARGETS[DEFAULT_DELIVERY];
  return targetLufs === d.targetLufs && ceilingDb === d.ceilingDb ? "" : `_L${targetLufs}C${ceilingDb}`;
}

export function deliveryFromTarget(targetLufs: number): DeliveryId {
  return DELIVERY_IDS.find((id) => DELIVERY_TARGETS[id].targetLufs === targetLufs) ?? DEFAULT_DELIVERY;
}
