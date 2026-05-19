import { test, expect, describe } from "bun:test";
import {
  insertTextAtLocation,
  appendToContent,
  replaceSection,
  validateMarkdownStructure,
} from "../src/contentManipulation.ts";

// ---------------------------------------------------------------------------
// insertTextAtLocation
// ---------------------------------------------------------------------------
describe("insertTextAtLocation", () => {
  test("inserts at the start (index 0)", () => {
    expect(insertTextAtLocation("world", "hello ", 0)).toBe("hello world");
  });

  test("inserts in the middle", () => {
    expect(insertTextAtLocation("helo world", "l", 3)).toBe("hello world");
  });

  test("inserts at the end (index === content.length)", () => {
    expect(insertTextAtLocation("hello", " world", 5)).toBe("hello world");
  });

  test("throws on negative index", () => {
    expect(() => insertTextAtLocation("hello", "x", -1)).toThrow();
  });

  test("throws when index > content.length", () => {
    expect(() => insertTextAtLocation("hello", "x", 10)).toThrow();
  });

  test("works on empty content at index 0", () => {
    expect(insertTextAtLocation("", "hi", 0)).toBe("hi");
  });
});

// ---------------------------------------------------------------------------
// appendToContent
// ---------------------------------------------------------------------------
describe("appendToContent", () => {
  test("appends text with a newline separator when content does not end with newline", () => {
    expect(appendToContent("hello", "world")).toBe("hello\nworld");
  });

  test("does not add an extra newline when content already ends with newline", () => {
    expect(appendToContent("hello\n", "world")).toBe("hello\nworld");
  });

  test("works with empty content — no leading newline", () => {
    expect(appendToContent("", "hello")).toBe("hello");
  });

  test("preserves content that ends with multiple newlines", () => {
    expect(appendToContent("hello\n\n", "world")).toBe("hello\n\nworld");
  });
});

// ---------------------------------------------------------------------------
// replaceSection
// ---------------------------------------------------------------------------
describe("replaceSection", () => {
  const doc = [
    "# Title",
    "",
    "Intro text.",
    "",
    "## Foo",
    "",
    "Foo content.",
    "",
    "## Bar",
    "",
    "Bar content.",
  ].join("\n");

  test("replaces a ## Foo section with new content", () => {
    const result = replaceSection(doc, "## Foo", "## Foo\n\nNew content.");
    expect(result).toContain("New content.");
    expect(result).not.toContain("Foo content.");
    // Following sections remain untouched
    expect(result).toContain("## Bar");
    expect(result).toContain("Bar content.");
  });

  test("throws an Error when the heading is not found", () => {
    expect(() => replaceSection(doc, "## Missing", "replacement")).toThrow();
  });

  test("respects equal-or-higher heading boundary (## Bar is NOT included in ## Foo section)", () => {
    const result = replaceSection(doc, "## Foo", "## Foo\n\nUpdated.");
    // The next sibling heading and its content must still be present
    expect(result).toContain("## Bar");
    expect(result).toContain("Bar content.");
  });

  test("replaces a section that runs all the way to EOF", () => {
    const simple = "## Foo\n\nFoo content.";
    const result = replaceSection(simple, "## Foo", "## Foo\n\nNew content.");
    expect(result).toContain("New content.");
    expect(result).not.toContain("Foo content.");
  });

  test("higher-level heading (# Title) ends a ## section early", () => {
    const nested = [
      "## Alpha",
      "",
      "Alpha text.",
      "",
      "# TopLevel",
      "",
      "Top text.",
    ].join("\n");
    const result = replaceSection(nested, "## Alpha", "## Alpha\n\nReplaced.");
    expect(result).toContain("# TopLevel");
    expect(result).toContain("Top text.");
    expect(result).not.toContain("Alpha text.");
  });
});

// ---------------------------------------------------------------------------
// validateMarkdownStructure
// ---------------------------------------------------------------------------
describe("validateMarkdownStructure", () => {
  test("valid markdown returns valid:true with no errors", () => {
    const content = [
      "# Title",
      "",
      "[a link](https://example.com)",
      "",
      "```",
      "some code",
      "```",
      "",
    ].join("\n");
    const result = validateMarkdownStructure(content);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("unbalanced '[' brackets returns valid:false", () => {
    const content = "# Title\n\n[unclosed link\n";
    const result = validateMarkdownStructure(content);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("unpaired code fence (odd number) returns valid:false", () => {
    const content = "# Title\n\n```\nunclosed code\n";
    const result = validateMarkdownStructure(content);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("invalid heading (no space after hashes) returns valid:false", () => {
    const content = "#BadHeading\n\nSome content.\n";
    const result = validateMarkdownStructure(content);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("too many hashes (7) returns valid:false", () => {
    const content = "####### Too deep\n\nContent.\n";
    const result = validateMarkdownStructure(content);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("paired fences and balanced brackets together are valid", () => {
    const content = "## Sec\n\n[text](url)\n\n```ts\nconst x = 1;\n```\n";
    const result = validateMarkdownStructure(content);
    expect(result.valid).toBe(true);
  });
});
