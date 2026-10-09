import { test } from "node:test";
import assert from "node:assert/strict";
import { createProUpload, proFiles, safeName, type ProObjects } from "./uploads";

function store() {
  const data = new Map<string, Uint8Array>();
  const signed: string[] = [];
  const o: ProObjects = {
    presign: (m, k, s, opts) => {
      signed.push(`${m} ${k} ${opts?.contentLength ?? opts?.downloadName ?? ""}`);
      return `https://r2/${k}`;
    },
    put: async (k, d) => void data.set(k, d),
    get: async (k) => data.get(k) ?? null,
  };
  return { o, data, signed };
}
const ID = "11111111-2222-3333-4444-555555555555";

test("nome seguro: sem caminho, sem acento, extensão mantida", () => {
  assert.equal(safeName("C:\\pasta\\Voz Principal (take 2).WAV"), "Voz-Principal-take-2.wav");
  assert.equal(safeName("../../ção.wav"), "cao.wav");
  assert.equal(safeName("###.mp3"), "faixa.mp3");
});

test("cria o envio: manifesto com dono e uma URL assinada por arquivo, com o tamanho", async () => {
  const s = store();
  const r = await createProUpload(s.o, "u1", [{ name: "Voz.wav", bytes: 100 }, { name: "Baixo.flac", bytes: 200 }], ID);
  assert.equal(r.ok, true);
  assert.deepEqual(s.signed, [`PUT cofre/pro/${ID}/01.wav 100`, `PUT cofre/pro/${ID}/02.flac 200`]);
  const m = JSON.parse(new TextDecoder().decode(s.data.get(`cofre/pro/${ID}/manifest.json`)!));
  assert.equal(m.user_id, "u1");
  assert.equal(m.files[1].name, "Baixo.flac");
});

test("recusa formato, tamanho, quantidade e lista vazia", async () => {
  for (const files of [[], [{ name: "x.exe", bytes: 1 }], [{ name: "x.wav", bytes: 3 * 1024 ** 3 }], Array.from({ length: 61 }, () => ({ name: "a.wav", bytes: 1 }))]) {
    assert.equal((await createProUpload(store().o, "u1", files, ID)).ok, false);
  }
});

test("arquivos só para o dono ou o admin; id inválido nem lê", async () => {
  const s = store();
  await createProUpload(s.o, "u1", [{ name: "Voz.wav", bytes: 100 }], ID);
  assert.equal(await proFiles(s.o, ID, { userId: "u2", admin: false }), null);
  assert.equal((await proFiles(s.o, ID, { userId: "u2", admin: true }))?.files[0].name, "Voz.wav");
  assert.equal((await proFiles(s.o, ID, { userId: "u1", admin: false }))?.files.length, 1);
  assert.equal(await proFiles(s.o, "../x", { userId: "u1", admin: true }), null);
});
