import { test, expect, describe, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { fileExists, readFile, writeFile, getFileChecksum } from "../src/fileOperations.ts";

const TEST_DIR = join(tmpdir(), `file-ops-test-${crypto.randomUUID()}`);

// Create tmp directory before tests run
await mkdir(TEST_DIR, { recursive: true });

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
describe("fileExists", () => {
  test("returns true for an existing file", async () => {
    const path = join(TEST_DIR, "exists.txt");
    await Bun.write(path, "hello");
    expect(await fileExists(path)).toBe(true);
  });

  test("returns false for a missing file", async () => {
    const path = join(TEST_DIR, "no-such-file-exists.txt");
    expect(await fileExists(path)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("readFile", () => {
  test("round-trips content", async () => {
    const path = join(TEST_DIR, "read-roundtrip.txt");
    const content = "Hello, UTF-8! 🎉 こんにちは";
    await Bun.write(path, content);
    expect(await readFile(path)).toBe(content);
  });

  test("throws a clear error on missing file", async () => {
    const path = join(TEST_DIR, "read-missing.txt");
    await expect(readFile(path)).rejects.toThrow(/File not found/);
  });
});

// ---------------------------------------------------------------------------
describe("writeFile", () => {
  test("writes content that can be read back", async () => {
    const path = join(TEST_DIR, "write-basic.txt");
    await writeFile(path, "test content");
    expect(await readFile(path)).toBe("test content");
  });

  test("overwrites existing content", async () => {
    const path = join(TEST_DIR, "write-overwrite.txt");
    await writeFile(path, "original");
    await writeFile(path, "updated");
    expect(await readFile(path)).toBe("updated");
  });

  test("atomic temp+rename: final file exists with correct content after write", async () => {
    const path = join(TEST_DIR, "write-atomic.txt");
    const content = "atomic write content ✓";
    await writeFile(path, content);
    // Final file must exist and have correct content
    expect(await fileExists(path)).toBe(true);
    expect(await readFile(path)).toBe(content);
    // No leftover .tmp- files should remain
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(TEST_DIR);
    const tmpFiles = entries.filter((e) => e.startsWith("write-atomic.txt.tmp-"));
    expect(tmpFiles.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("getFileChecksum", () => {
  test("same content produces the same checksum", async () => {
    const path1 = join(TEST_DIR, "checksum-same-1.txt");
    const path2 = join(TEST_DIR, "checksum-same-2.txt");
    const content = "identical content";
    await Bun.write(path1, content);
    await Bun.write(path2, content);
    expect(await getFileChecksum(path1)).toBe(await getFileChecksum(path2));
  });

  test("different content produces different checksums", async () => {
    const path1 = join(TEST_DIR, "checksum-diff-1.txt");
    const path2 = join(TEST_DIR, "checksum-diff-2.txt");
    await Bun.write(path1, "content A");
    await Bun.write(path2, "content B");
    expect(await getFileChecksum(path1)).not.toBe(await getFileChecksum(path2));
  });
});
