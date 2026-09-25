/**
 * Teste ponta a ponta do fluxo principal do MVP contra uma stack real
 * (Supabase/GoTrue/PostgREST + MinIO + worker + Next.js rodando).
 *
 *   node scripts/e2e.mjs            (com o app em http://localhost:3000)
 *
 * Critérios verificados: cadastro, 5 downloads, projeto, upload, análise pelo
 * worker, preview A/B, cache, render, download consome 1 crédito, re-download
 * grátis, bloqueio sem crédito, isolamento entre usuários e páginas SSR.
 */
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const APP = process.env.APP_URL ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let passed = 0;
const ok = (cond, msg) => {
  if (!cond) throw new Error(`✗ ${msg}`);
  passed++;
  console.log(`✓ ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeoutMs = 180_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout esperando: ${label}`);
    await sleep(1000);
  }
}

/** Usuário com sessão em cookies (igual ao navegador) para chamar as rotas do Next. */
async function newUser(tag) {
  const jar = new Map();
  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const email = `e2e-${tag}-${Date.now()}@example.com`;
  const { data, error } = await supabase.auth.signUp({ email, password: "senha-forte-123", options: { data: { display_name: `Teste ${tag}` } } });
  if (error || !data.session) throw new Error(`cadastro falhou: ${error?.message}`);
  const cookie = () => [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  const http = (path, init = {}) => fetch(APP + path, { ...init, redirect: "manual", headers: { ...(init.headers ?? {}), cookie: cookie() } });
  return { supabase, http, id: data.user.id, email };
}

/** WAV 16-bit estéreo sintético: 5 s de introdução baixa + "voz" harmônica com vibrato. */
function makeWav(seconds = 40, sr = 44100) {
  const n = seconds * sr;
  const data = Buffer.alloc(n * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 220 * (1 + 0.01 * Math.sin(2 * Math.PI * 5 * t));
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
    const env = t < 5 ? 0.05 : 0.35 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t));
    const s = Math.max(-1, Math.min(1, v * env * 0.5 + rnd() * 0.003));
    data.writeInt16LE(Math.round(s * 32767), i * 4);
    data.writeInt16LE(Math.round(s * 0.9 * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function waitJob(supabase, id, label) {
  return waitFor(async () => {
    const { data } = await supabase.from("processing_jobs").select("*").eq("id", id).single();
    if (data?.status === "failed") throw new Error(`${label} falhou: ${data.error_code} ${data.error_message}`);
    return data?.status === "completed" ? data : null;
  }, label);
}

async function main() {
  console.log(`\nE2E Mix Pro → ${APP}\n`);

  // 1–2. Cadastro e créditos iniciais
  const ana = await newUser("ana");
  ok(ana.id, "usuário consegue criar conta");
  const { data: bal0 } = await ana.supabase.rpc("my_credit_balance", { p_kind: "download" });
  ok(bal0 === 5, `novo usuário recebe 5 downloads (saldo=${bal0})`);

  const dash = await ana.http("/app");
  const dashHtml = await dash.text();
  ok(dash.status === 200 && dashHtml.includes("Teste"), "dashboard renderiza para o usuário logado");
  ok((await fetch(APP + "/app", { redirect: "manual" })).status === 307, "/app sem login redireciona para /entrar");

  // 3. Projeto + faixa (mesmo fluxo do assistente)
  const { data: project } = await ana.supabase.from("projects").insert({ user_id: ana.id, name: "Voz E2E", audio_type: "vocal" }).select().single();
  const { data: track } = await ana.supabase
    .from("tracks")
    .insert({ project_id: project.id, user_id: ana.id, name: "Voz", category_id: "vocal" })
    .select()
    .single();
  ok(project && track, "usuário consegue criar projeto");

  // 4. Upload direto ao storage via URL assinada
  const wav = makeWav();
  const init = await ana.http("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project_id: project.id, track_id: track.id, file_name: "voz-e2e.wav", size_bytes: wav.length }),
  });
  const initBody = await init.json();
  ok(init.status === 200 && initBody.upload_url, "API emite URL assinada de upload");
  const put = await fetch(initBody.upload_url, { method: "PUT", body: wav, headers: { "content-type": initBody.content_type } });
  ok(put.ok, `arquivo enviado direto ao storage (HTTP ${put.status})`);
  const done = await ana.http(`/api/uploads/${initBody.file_id}/complete`, { method: "POST" });
  ok(done.status === 200, "upload confirmado e análise enfileirada");

  const bad = await ana.http("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project_id: project.id, file_name: "virus.exe", size_bytes: 10 }),
  });
  ok(bad.status === 400, "formato inválido é rejeitado no upload");

  // 5. Worker analisa (FLAC, waveform, metadados)
  const source = await waitFor(async () => {
    const { data } = await ana.supabase.from("audio_files").select("*").eq("id", initBody.file_id).single();
    if (data?.status === "invalid") throw new Error(`arquivo inválido: ${data.error_message}`);
    return data?.status === "ready" ? data : null;
  }, "análise do upload");
  ok(source.duration_s > 39.9 && source.sample_rate === 44100 && source.channels === 2, `metadados corretos (${source.duration_s}s, ${source.sample_rate} Hz)`);
  ok(source.storage_key.endsWith(".flac"), "WAV compactado sem perdas para FLAC no storage");
  ok(source.analysis?.thumb?.length === 64 && source.peaks_key, "waveform gerada");
  ok(source.analysis.suggested_preview_start >= 4.5, `trecho sugerido pula a introdução (início=${source.analysis.suggested_preview_start}s)`);

  const page = await ana.http(`/app/projetos/${project.id}`);
  ok(page.status === 200, "workspace do projeto renderiza");

  // 6. Preview com preset (A/B)
  const { data: preset } = await ana.supabase.from("presets").select("id,name,current_version_id").eq("slug", "vocal-presence").single();
  const { data: pj, error: pe } = await ana.supabase.rpc("enqueue_track_job", {
    p_track: track.id,
    p_type: "preview",
    p_preset_version: preset.current_version_id,
    p_intensity: 75,
    p_params: { start_s: source.analysis.suggested_preview_start },
  });
  ok(!pe && pj.status === "queued", "preview enfileirado");
  const previewJob = await waitJob(ana.supabase, pj.id, "preview");
  ok(previewJob.output_file_id, `worker processou o preview (${previewJob.duration_ms} ms)`);

  const files = await (await ana.http(`/api/files/${previewJob.output_file_id}`)).json();
  ok(files.url && files.pair?.url, "API devolve A (original) e B (processado)");
  const [bufB, bufA] = await Promise.all([fetch(files.url).then((r) => r.arrayBuffer()), fetch(files.pair.url).then((r) => r.arrayBuffer())]);
  ok(Buffer.from(bufB).subarray(0, 4).toString() === "fLaC" && Buffer.from(bufA).subarray(0, 4).toString() === "fLaC", "A e B são FLAC reproduzíveis");
  ok(Math.abs(files.duration_s - files.pair.duration_s) < 0.01 && Math.abs(files.duration_s - 30) < 0.1, "A e B têm a mesma duração (30 s) → A/B sincronizado");
  ok(files.analysis.lufs_integrated !== files.pair.analysis.lufs_integrated, `preset altera o som (LUFS ${files.pair.analysis.lufs_integrated} → ${files.analysis.lufs_integrated})`);
  ok(files.peaks?.length > 100 && files.pair.peaks?.length > 100, "picos de waveform de A e B disponíveis");

  const { data: again } = await ana.supabase.rpc("enqueue_track_job", {
    p_track: track.id,
    p_type: "preview",
    p_preset_version: preset.current_version_id,
    p_intensity: 75,
    p_params: { start_s: source.analysis.suggested_preview_start },
  });
  ok(again.cache_hit && again.output_file_id === previewJob.output_file_id, "mesmo áudio + preset + intensidade reaproveita o cache");
  ok((await ana.supabase.rpc("my_credit_balance", { p_kind: "download" })).data === 5, "preview não consome download");

  // 7. Render + download (consome 1 crédito uma única vez)
  const render = async (format, intensity = 75) => {
    const { data, error } = await ana.supabase.rpc("enqueue_track_job", {
      p_track: track.id,
      p_type: "render",
      p_preset_version: preset.current_version_id,
      p_intensity: intensity,
      p_params: { format },
    });
    if (error) throw error;
    return waitJob(ana.supabase, data.id, `render ${format}`);
  };
  const r1 = await render("wav");
  const d1 = await (await ana.http(`/api/downloads/${r1.output_file_id}`, { method: "POST" })).json();
  ok(d1.charged === true && d1.balance === 4, `download consome 1 crédito (saldo=${d1.balance})`);
  const file = Buffer.from(await (await fetch(d1.url)).arrayBuffer());
  ok(file.subarray(0, 4).toString() === "RIFF" && file.subarray(8, 12).toString() === "WAVE", "arquivo final é WAV válido");
  const expected = 40 * 44100 * 2 * 2;
  ok(Math.abs(file.length - 44 - expected) < 4096, `WAV completo com a duração original (${file.length} bytes, 16-bit como a fonte)`);

  const d2 = await (await ana.http(`/api/downloads/${r1.output_file_id}`, { method: "POST" })).json();
  ok(d2.charged === false && d2.balance === 4, "re-download do mesmo resultado não cobra de novo");

  const r2 = await render("mp3");
  const d3 = await (await ana.http(`/api/downloads/${r2.output_file_id}`, { method: "POST" })).json();
  const mp3 = Buffer.from(await (await fetch(d3.url)).arrayBuffer());
  ok(d3.charged && d3.balance === 3 && (mp3.subarray(0, 3).toString() === "ID3" || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0)), "export MP3 funciona");

  // 8. Sem crédito → bloqueia
  await admin.rpc("grant_credits", {
    p_user: ana.id, p_kind: "download", p_type: "ADMIN_ADJUSTMENT", p_amount: -3, p_reason: "e2e: zerar saldo",
  });
  const r3 = await render("wav", 50);
  const blocked = await ana.http(`/api/downloads/${r3.output_file_id}`, { method: "POST" });
  ok(blocked.status === 402, "sem crédito, o download é bloqueado (HTTP 402)");
  const again2 = await ana.http(`/api/downloads/${r1.output_file_id}`, { method: "POST" });
  ok(again2.status === 200, "mesmo sem saldo, re-download de resultado já pago continua liberado");

  // 9. Isolamento entre usuários
  const bia = await newUser("bia");
  ok((await bia.http(`/api/files/${previewJob.output_file_id}`)).status === 404, "outro usuário não acessa arquivos alheios");
  ok((await bia.http(`/api/downloads/${r1.output_file_id}`, { method: "POST" })).status >= 400, "outro usuário não baixa resultados alheios");
  const { error: steal } = await bia.supabase.rpc("enqueue_track_job", { p_track: track.id, p_type: "preview", p_preset_version: null, p_intensity: 50, p_params: {} });
  ok(steal, "outro usuário não processa pistas alheias");
  const { data: seen } = await bia.supabase.from("projects").select("id");
  ok(seen.length === 0, "outro usuário não enxerga projetos alheios");
  ok((await bia.http(`/app/projetos/${project.id}`)).status === 404, "workspace alheio retorna 404");

  // 10. Admin
  ok((await ana.http("/admin")).status === 307, "usuário comum não acessa /admin");
  await admin.from("profiles").update({ role: "admin" }).eq("id", ana.id);
  ok((await ana.http("/admin")).status === 200, "admin acessa o painel");
  ok((await ana.http(`/admin/presets/${preset.id}`)).status === 200, "admin abre o editor de presets");

  // 11. Exclusão de projeto
  const { error: delErr } = await ana.supabase.rpc("delete_project", { p_project: project.id });
  ok(!delErr, "usuário exclui o projeto (arquivos removidos pelo worker em segundo plano)");

  for (const p of ["/", "/entrar", "/cadastro", "/termos", "/privacidade", "/manifest.webmanifest"]) {
    ok((await fetch(APP + p)).status === 200, `página pública ${p} responde`);
  }

  console.log(`\n${passed} verificações passaram.\n`);
}

main().catch((e) => {
  console.error(`\n${e.message}\n(${passed} verificações passaram antes da falha)`);
  process.exit(1);
});
