import { ImageResponse } from "next/og";

export const alt = "Mix Pro — Som de estúdio e legendas nos seus vídeos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function OgCard({ kicker, title, highlight, footer }: { kicker: string; title: string; highlight: string; footer: string }) {
  const bars = [30, 70, 110, 60, 140, 90, 50, 120, 80, 40, 100, 65];
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "linear-gradient(135deg, #2a1b4f 0%, #0b0b22 55%, #06061a 100%)",
        color: "white",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[18, 40, 60, 32, 50, 24].map((h, i) => (
            <div key={i} style={{ width: 8, height: h, borderRadius: 4, background: "linear-gradient(180deg, #d946ef, #3b82f6)" }} />
          ))}
        </div>
        <div style={{ fontSize: 44, fontWeight: 800 }}>Mix Pro</div>
        <div style={{ marginLeft: 24, fontSize: 26, color: "#c4b5fd", padding: "8px 20px", borderRadius: 999, border: "2px solid #7c3aed" }}>
          {kicker}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 74, fontWeight: 800, lineHeight: 1.05, maxWidth: 1000 }}>
        <span>{title}</span>
        <span style={{ color: "#ffe500" }}>{highlight}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ fontSize: 30, color: "#a3a3c8" }}>{footer}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {bars.map((h, i) => (
            <div key={i} style={{ width: 14, height: h, borderRadius: 7, background: "linear-gradient(180deg, #f0abfc, #93c5fd)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        kicker="grátis para começar"
        title="Som de estúdio e legendas"
        highlight="nos seus vídeos, em 1 minuto."
        footer="Presets profissionais · remoção de ruído · cortes · 9:16"
      />
    ),
    size,
  );
}
