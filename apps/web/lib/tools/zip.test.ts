import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zipStore } from "./zip";

test("CRC32 confere com o valor de referência", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("o ZIP abre num descompactador real com os arquivos intactos", () => {
  const a = new Uint8Array(5000).map((_, i) => i % 251);
  const b = new TextEncoder().encode("faixa dois");
  const zip = zipStore([{ name: "faixa-01.wav", data: a }, { name: "faixa-02.mp3", data: b }]);
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  try {
    const f = join(dir, "album.zip");
    writeFileSync(f, zip);
    // o zipfile do Python confere o CRC de cada arquivo (testzip) e extrai
    const py = process.platform === "win32" ? "python" : "python3";
    const bad = execFileSync(py, ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); z.extractall(sys.argv[2])", f, dir]).toString().trim();
    assert.equal(bad, "None");
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, "faixa-01.wav"))), a);
    assert.equal(readFileSync(join(dir, "faixa-02.mp3"), "utf8"), "faixa dois");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
