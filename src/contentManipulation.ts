/**
 * Insert `text` at character offset `index`.
 * If index < 0 or > content.length, throw.
 */
export function insertTextAtLocation(content: string, text: string, index: number): string {
  if (index < 0 || index > content.length) {
    throw new Error(
      `Index ${index} is out of bounds for content of length ${content.length}`,
    );
  }
  return content.slice(0, index) + text + content.slice(index);
}

/**
 * Append `text` to content.
 * If content doesn't end with newline and isn't empty, add one before appending.
 */
export function appendToContent(content: string, text: string): string {
  if (content.length === 0) {
    return text;
  }
  if (content.endsWith("\n")) {
    return content + text;
  }
  return content + "\n" + text;
}

/**
 * Replace the section under markdown heading `heading` with `replacement`.
 * "Section" = lines from the heading up to (but not including) the next
 * heading of equal-or-higher level, or EOF.
 * Throws if the heading is not found.
 */
export function replaceSection(
  content: string,
  heading: string,
  replacement: string,
): string {
  const headingMatch = heading.match(/^(#{1,6})\s/);
  if (!headingMatch) {
    throw new Error(`Invalid heading format: "${heading}"`);
  }
  const levelStr = headingMatch[1];
  if (levelStr === undefined) {
    throw new Error(`Invalid heading format: "${heading}"`);
  }
  const level = levelStr.length;

  const lines = content.split("\n");

  // Find the line that exactly matches the target heading
  const headingIndex = lines.findIndex(
    (line) => line === heading || line.trimEnd() === heading.trimEnd(),
  );
  if (headingIndex === -1) {
    throw new Error(`Heading not found: "${heading}"`);
  }

  // Find the end of the section: first line after headingIndex that is a
  // heading of equal or higher level (fewer or equal number of '#' chars).
  let endIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const match = line.match(/^(#{1,6})\s/);
    if (match) {
      const matchLevelStr = match[1];
      if (matchLevelStr !== undefined && matchLevelStr.length <= level) {
        endIndex = i;
        break;
      }
    }
  }

  const before = lines.slice(0, headingIndex);
  const after = lines.slice(endIndex);

  return [...before, replacement, ...after].join("\n");
}

/**
 * Validate the structural integrity of a markdown string.
 * Returns { valid: boolean, errors: string[] }.
 *
 * Checks:
 *   - Markdown link brackets are balanced (equal number of '[' and ']')
 *   - Code fences (```) are paired (even count)
 *   - Heading lines start with `# ` through `###### `
 */
export function validateMarkdownStructure(content: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check bracket balance
  let openBrackets = 0;
  let closeBrackets = 0;
  for (const char of content) {
    if (char === "[") openBrackets++;
    else if (char === "]") closeBrackets++;
  }
  if (openBrackets !== closeBrackets) {
    errors.push(
      `Unbalanced brackets: ${openBrackets} opening '[' vs ${closeBrackets} closing ']'`,
    );
  }

  // Check code fences are paired (must appear an even number of times)
  const lines = content.split("\n");
  let fenceCount = 0;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      fenceCount++;
    }
  }
  if (fenceCount % 2 !== 0) {
    errors.push(
      `Unpaired code fence: found ${fenceCount} code fence marker(s) (expected an even number)`,
    );
  }

  // Check that every line starting with '#' is a valid heading (1-6 hashes + space)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.startsWith("#")) {
      if (!/^#{1,6} /.test(line)) {
        errors.push(`Invalid heading on line ${i + 1}: "${line}"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
