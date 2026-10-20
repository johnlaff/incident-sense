/**
 * Swap the hyphens inside names like "PIX-Core" or "App-Mobile" for
 * non-breaking ones, so a title never wraps in the middle of a name.
 */
export function keepWhole(text: string): string {
  return text.replace(/(\p{L}|\d)-(?=\p{L}|\d)/gu, "$1‑");
}
