/**
 * Swap the hyphens inside names like "PIX-Core" or "App-Mobile" for
 * non-breaking ones, so a title never wraps in the middle of a name.
 */
export function keepWhole(text: string): string {
  return text.replace(/(\p{L}|\d)-(?=\p{L}|\d)/gu, "$1‑");
}

/** Lowercase, no accents, single spaces: how a search compares text. */
export function searchKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the text holds the query, ignoring accents and extra spaces. */
export function matchesQuery(text: string, query: string): boolean {
  const q = searchKey(query);
  return q === "" || searchKey(text).includes(q);
}
