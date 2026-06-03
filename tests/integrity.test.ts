import { test, expect, describe, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { calculateChecksum, verifyContentIntegrity, detectConcurrentAccess } from "../src/integrity.ts";
import { encodeToUTF8 } from "../src/encoding.ts";

const TEST_DIR = join(tmpdir(), `integrity-test-${crypto.randomUUID()}`);

// Create tmp directory before tests run
await mkdir(TEST_DIR, { recursive: true });

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
describe("calculateChecksum", () => {
  test("is deterministic — same input always produces same output", () => {
    const input = "hello, checksum world!";
    expect(calculateChecksum(input)).toBe(calculateChecksum(input));
  });

  test("string and Uint8Array of the same UTF-8 bytes produce equal checksums", () => {
    const str = "bytes equal";
    const bytes = encodeToUTF8(str);
    expect(calculateChecksum(str)).toBe(calculateChecksum(bytes));
  });

  test("different inputs produce different checksums", () => {
    expect(calculateChecksum("foo")).not.toBe(calculateChecksum("bar"));
  });

  test("empty string has a stable checksum", () => {
    // SHA-256 of empty string is well-known
    expect(calculateChecksum("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

// ---------------------------------------------------------------------------
describe("verifyContentIntegrity", () => {
  test("returns true for a matching checksum (string)", () => {
    const content = "verify me please";
    const checksum = calculateChecksum(content);
    expect(verifyContentIntegrity(content, checksum)).toBe(true);
  });

  test("returns false for a mismatched checksum", () => {
    expect(verifyContentIntegrity("some content", "wrongchecksum")).toBe(false);
  });

  test("returns true for a matching checksum (Uint8Array)", () => {
    const bytes = encodeToUTF8("verify bytes too");
    const checksum = calculateChecksum(bytes);
    expect(verifyContentIntegrity(bytes, checksum)).toBe(true);
  });

  test("returns false when checksum is for different content", () => {
    const checksum = calculateChecksum("original");
    expect(verifyContentIntegrity("tampered", checksum)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("detectConcurrentAccess", () => {
  test("returns false when file has not been modified since `since` (since is in the future)", async () => {
    const path = join(TEST_DIR, "unchanged.txt");
    await writeFile(path, "unchanged content");
    // `since` is set far in the future relative to the file's mtime
    const since = Date.now() + 60_000;
    expect(await detectConcurrentAccess(path, since)).toBe(false);
  });

  test("returns true when file was modified after `since` (since is in the past)", async () => {
    const path = join(TEST_DIR, "modified.txt");
    // `since` is set well before we write the file
    const since = Date.now() - 60_000;
    await writeFile(path, "modified content");
    expect(await detectConcurrentAccess(path, since)).toBe(true);
  });

  test("returns true when the file does not exist", async () => {
    const path = join(TEST_DIR, "nonexistent-for-concurrent.txt");
    const since = Date.now();
    expect(await detectConcurrentAccess(path, since)).toBe(true);
  });
});
