const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

export function encodeToUTF8(input: string): Uint8Array {
  return encoder.encode(input);
}

export function decodeFromUTF8(input: Uint8Array): string {
  return decoder.decode(input);
}

/**
 * Detects the encoding of a buffer.
 * - Returns "utf-8-bom" if the buffer starts with the UTF-8 BOM (EF BB BF).
 * - Returns "utf-8" if the buffer is valid UTF-8.
 * - Returns "unknown" if the buffer cannot be decoded as UTF-8.
 */
export function detectEncoding(buffer: Uint8Array): "utf-8" | "utf-8-bom" | "unknown" {
  // Check for UTF-8 BOM: EF BB BF
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "utf-8-bom";
  }

  // Try strict UTF-8 decoding
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return "utf-8";
  } catch {
    return "unknown";
  }
}
