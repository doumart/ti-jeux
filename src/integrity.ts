import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { encodeToUTF8 } from "./encoding.ts";

/**
 * Calculates the SHA-256 hex digest of a string (UTF-8 encoded) or a Uint8Array.
 */
export function calculateChecksum(content: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof content === "string") {
    hash.update(encodeToUTF8(content));
  } else {
    hash.update(content);
  }
  return hash.digest("hex");
}

/**
 * Returns true if the SHA-256 of `content` matches `expectedChecksum`.
 */
export function verifyContentIntegrity(
  content: string | Uint8Array,
  expectedChecksum: string,
): boolean {
  return calculateChecksum(content) === expectedChecksum;
}

/**
 * Heuristic concurrent-access detection.
 * Returns true if the file's mtime has changed since `since` (a number from Date.now()),
 * or if the file doesn't exist when it should.
 */
export async function detectConcurrentAccess(path: string, since: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.mtimeMs > since;
  } catch {
    // File doesn't exist when it should
    return true;
  }
}
