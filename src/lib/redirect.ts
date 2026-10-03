/** Return a normalized internal URL; reject browser URL-normalization escapes. */
export function sanitizeRedirect(target: string): string {
  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("\\") ||
    [...target].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  ) {
    return "/";
  }
  try {
    const base = "https://llvy.invalid";
    const url = new URL(target, base);
    if (url.origin !== base || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
