/** Sem o service worker ativo o compartilhamento chega aqui: leva para o estúdio para escolher o arquivo. */
export function POST(req: Request) {
  return Response.redirect(new URL("/estudio", req.url), 303);
}

export function GET(req: Request) {
  return Response.redirect(new URL("/estudio", req.url), 307);
}
