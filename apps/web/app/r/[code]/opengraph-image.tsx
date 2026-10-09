import { ImageResponse } from "next/og";
import { OgCard } from "../../opengraph-image";

export const alt = "Convite Mix Pro: créditos extras";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        kicker="você foi convidado"
        title="Ganhe +10 créditos"
        highlight="e deixe seus vídeos com som de estúdio."
        footer="5 downloads grátis ao entrar · mixagem e masterização"
      />
    ),
    size,
  );
}
