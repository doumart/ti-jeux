import { rename, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { encodeToUTF8 } from "./encoding.ts";

/**
 * Returns true if the file at `path` exists and is accessible, false otherwise.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the file at `path` as a UTF-8 string.
 * Throws a clear Error if the file is missing or unreadable.
 */
export async function readFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }
  try {
    return await file.text();
  } catch (err) {
    throw new Error(
      `Failed to read file: ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Atomically writes `content` (UTF-8 encoded) to `path`.
 * Uses a `.tmp-<random>` intermediate file and renames it to ensure atomicity.
 */
export async function writeFile(path: string, content: string): Promise<void> {
  const random = crypto.randomUUID().replace(/-/g, "");
  const tmpPath = `${path}.tmp-${random}`;
  await Bun.write(tmpPath, encodeToUTF8(content));
  await rename(tmpPath, path);
}

/**
 * Returns the SHA-256 hex digest of the file's raw bytes on disk.
 * Throws a clear Error if the file is missing.
 */
export async function getFileChecksum(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}
