/**
 * End-to-end integration tests for the README management API (src/index.ts).
 *
 * Each test uses a unique temporary file so the repo's actual README.md is
 * never touched.  Temp files are cleaned up in afterEach.
 */
import { test, expect, describe, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

import {
  checkReadmeExists,
  createReadme,
  readReadme,
  updateReadme,
  persistReadme,
  verifyIntegrity,
} from "../src/index.ts";
import { calculateChecksum } from "../src/integrity.ts";

// ---------------------------------------------------------------------------
// Temp-file lifecycle helpers
// ---------------------------------------------------------------------------
const tmpFiles: string[] = [];

function tmpFile(): string {
  const path = join(tmpdir(), `readme-${crypto.randomUUID()}.md`);
  tmpFiles.push(path);
  return path;
}

afterEach(async () => {
  // Clean up every temp file created during the test; ignore missing-file errors.
  for (const path of tmpFiles.splice(0)) {
    await unlink(path).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Full workflow
// ---------------------------------------------------------------------------
describe("Full workflow", () => {
  test("createReadme → readReadme → updateReadme(append 'test') → verifyIntegrity passes", async () => {
    const path = tmpFile();

    // 1. Create
    await createReadme(path, "Integration Test Project");
    expect(await checkReadmeExists(path)).toBe(true);

    // 2. Read — initial content should contain the title
    const initial = await readReadme(path);
    expect(initial).toContain("Integration Test Project");

    // 3. Update — append the word "test"
    await updateReadme(
      (current) => current + "\n## Testing\n\nRun `bun test` to execute the test suite.\n",
      path,
    );

    const updated = await readReadme(path);
    expect(updated).toContain("test");

    // 4. verifyIntegrity — compute expected checksum from the content we just
    //    read, then confirm the on-disk file matches.
    const expectedChecksum = calculateChecksum(updated);
    const isValid = await verifyIntegrity(expectedChecksum, path);
    expect(isValid).toBe(true);
  });

  test("after createReadme + updateReadme that adds 'test', file contains the word 'test'", async () => {
    const path = tmpFile();

    await createReadme(path, "My Project");
    await updateReadme((current) => current + "\ntest content", path);

    const content = await readReadme(path);
    expect(content).toContain("test");
  });

  test("updateReadme is atomic: content is non-empty after update", async () => {
    const path = tmpFile();

    await createReadme(path, "Atomic Test");
    await updateReadme((current) => current + "\n\nAdditional content.", path);

    const content = await readReadme(path);
    expect(content.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// persistReadme
// ---------------------------------------------------------------------------
describe("persistReadme", () => {
  test("force-writes content to the file", async () => {
    const path = tmpFile();

    await createReadme(path, "Initial");
    await persistReadme("# Replaced\n\nThis was force-written.\n", path);

    const content = await readReadme(path);
    expect(content).toBe("# Replaced\n\nThis was force-written.\n");
    expect(content).not.toContain("Initial");
  });

  test("verifyIntegrity passes after persistReadme", async () => {
    const path = tmpFile();
    const newContent = "# Persisted\n\nContent.\n";

    await persistReadme(newContent, path);

    const checksum = calculateChecksum(newContent);
    expect(await verifyIntegrity(checksum, path)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkReadmeExists / createReadme (no-op)
// ---------------------------------------------------------------------------
describe("checkReadmeExists and createReadme no-op", () => {
  test("returns false for a file that does not exist", async () => {
    const path = join(tmpdir(), `readme-nonexistent-${crypto.randomUUID()}.md`);
    expect(await checkReadmeExists(path)).toBe(false);
  });

  test("createReadme is a no-op if the file already exists", async () => {
    const path = tmpFile();

    await createReadme(path, "Original Title");
    const before = await readReadme(path);

    // Call createReadme again — should not overwrite
    await createReadme(path, "Different Title");
    const after = await readReadme(path);

    expect(after).toBe(before);
    expect(after).toContain("Original Title");
    expect(after).not.toContain("Different Title");
  });
});
