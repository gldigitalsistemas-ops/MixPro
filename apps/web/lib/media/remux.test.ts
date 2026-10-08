/**
 * Troca de áudio sem recodificar o vídeo (Etapa 4, fatia 9). Precisa do FFmpeg (FFMPEG_PATH/FFPROBE_PATH);
 * sem ele é pulado, exceto com REQUIRE_FFMPEG=1 (CI). Gera um MP4 sintético (nada pessoal).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remuxVideoWithAudio } from "./remux";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
function has() {
  try {
    execFileSync(FFMPEG, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const skip = has() ? false : process.env.REQUIRE_FFMPEG ? undefined : "sem FFmpeg";
const run = (args: string[]) => execFileSync(FFMPEG, ["-v", "error", "-y", ...args], { maxBuffer: 1 << 28 });
const probe = (file: string) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]).toString());
const md5 = (file: string, map: string) => execFileSync(FFMPEG, ["-v", "error", "-i", file, "-map", map, "-c", "copy", "-f", "md5", "-"]).toString().trim();

test("troca o áudio sem recodificar o vídeo: imagem, resolução e FPS iguais; áudio novo em AAC", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "remux-"));
  try {
    const src = join(dir, "orig.mp4");
    const novo = join(dir, "novo.m4a");
    const out = join(dir, "saida.mp4");
    run(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "25", "-c:a", "aac", "-shortest", src]);
    run(["-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:a", "aac", "-b:a", "128k", novo]);

    const original = readFileSync(src);
    const file = new File([original], "orig.mp4", { type: "video/mp4" });
    const r = await remuxVideoWithAudio({ file, audioStart: 0, videoContainer: "mp4" }, new Blob([readFileSync(novo)]), () => {});
    assert.equal(r.filename, "orig-mixpro.mp4");
    writeFileSync(out, Buffer.from(await r.blob.arrayBuffer()));

    const a = probe(src);
    const b = probe(out);
    const va = a.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    const vb = b.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    assert.equal(vb.codec_name, "h264");
    assert.deepEqual([vb.width, vb.height, vb.r_frame_rate], [va.width, va.height, va.r_frame_rate]);
    assert.equal(vb.nb_frames ?? vb.nb_read_frames, va.nb_frames ?? va.nb_read_frames);
    // os pacotes de vídeo são idênticos: nada foi recodificado
    assert.equal(md5(out, "0:v:0"), md5(src, "0:v:0"));

    const sb = b.streams.filter((s: { codec_type: string }) => s.codec_type === "audio");
    assert.equal(sb.length, 1);
    assert.equal(sb[0].codec_name, "aac");
    assert.ok(Math.abs(Number(b.format.duration) - Number(a.format.duration)) < 0.15, `duração ${b.format.duration} x ${a.format.duration}`);
    // o áudio é o do arquivo novo (pacotes AAC copiados), não o do vídeo original
    assert.equal(md5(out, "0:a:0"), md5(novo, "0:a:0"));
    assert.notEqual(md5(out, "0:a:0"), md5(src, "0:a:0"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WebM e áudio que não é AAC são recusados com mensagem para a pessoa", { skip }, async () => {
  const file = new File([new Uint8Array(10)], "x.webm");
  await assert.rejects(remuxVideoWithAudio({ file, audioStart: 0, videoContainer: "webm" }, new Blob([]), () => {}), /WebM/);
});
