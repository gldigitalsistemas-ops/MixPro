/**
 * Destino depois do login: só caminhos do próprio site. Bloqueia "//site", "/\site" (o navegador
 * trata "\" como "/") e esquemas como "javascript:", que levariam a outro site (phishing).
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f]/.test(next)) return "/";
  try {
    const base = "https://mixpro.local";
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
