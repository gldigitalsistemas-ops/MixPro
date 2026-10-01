/** Versão publicada agora (o app aberto compara com a sua para avisar que há atualização). */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
