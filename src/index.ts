/**
 * Public API for README management.
 *
 * Default README path is "README.md" (relative to CWD). All functions accept
 * an optional `path` parameter to override this default.
 */

import { fileExists, readFile, writeFile, getFileChecksum } from "./fileOperations.ts";
import { verifyContentIntegrity } from "./integrity.ts";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DEFAULT_README_PATH = "README.md";

function resolvePath(path?: string): string {
  return path ?? DEFAULT_README_PATH;
}

/**
 * Returns true if the README file exists on disk.
 */
export async function checkReadmeExists(path?: string): Promise<boolean> {
  return fileExists(resolvePath(path));
}

/**
 * Creates the README file with a minimal title + description if it doesn't
 * already exist. No-op if it already exists.
 */
export async function createReadme(path?: string, title?: string): Promise<void> {
  const resolvedPath = resolvePath(path);
  if (await fileExists(resolvedPath)) {
    return;
  }
  const resolvedTitle = title ?? "README";
  const content = `# ${resolvedTitle}\n\nThis project was generated with bun.\n`;
  await writeFile(resolvedPath, content);
}

/**
 * Reads and returns the current README content.
 */
export async function readReadme(path?: string): Promise<string> {
  return readFile(resolvePath(path));
}

/**
 * Write `content` to `targetPath` atomically by writing to a temp file first
 * and then renaming into place.
 */
async function atomicWrite(targetPath: string, content: string): Promise<void> {
  const tmpPath = join(tmpdir(), `readme-${crypto.randomUUID()}.tmp`);
  await Bun.write(tmpPath, content);
  await rename(tmpPath, targetPath);
}

/**
 * Apply `transform` to the current README content and persist the result
 * atomically. The file will contain either the old content or the new content,
 * never an empty/partial state.
 */
export async function updateReadme(
  transform: (current: string) => string,
  path?: string,
): Promise<void> {
  const resolvedPath = resolvePath(path);
  const current = await readFile(resolvedPath);
  const updated = transform(current);
  await atomicWrite(resolvedPath, updated);
}

/**
 * Force-write the given content to the README atomically.
 */
export async function persistReadme(content: string, path?: string): Promise<void> {
  await atomicWrite(resolvePath(path), content);
}

/**
 * Returns true if the on-disk file's checksum matches `expectedChecksum`.
 */
export async function verifyIntegrity(
  expectedChecksum: string,
  path?: string,
): Promise<boolean> {
  const resolvedPath = resolvePath(path);
  const content = await readFile(resolvedPath);
  return verifyContentIntegrity(content, expectedChecksum);
}
