/**
 * A pasted link if it is an https page on shimo.im (or a team's *.shimo.im),
 * so the Shimo window never frames other sites; a bare "shimo.im/…" gets https
 */
export function parseShimoUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(
      /^[a-z]+:/i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (host !== "shimo.im" && !host.endsWith(".shimo.im")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function loadShimoUrl(storageKey: string): string {
  try {
    return parseShimoUrl(localStorage.getItem(storageKey) || "") || "";
  } catch {
    return "";
  }
}

export function saveShimoUrl(storageKey: string, url: string) {
  try {
    if (url) localStorage.setItem(storageKey, url);
    else localStorage.removeItem(storageKey);
  } catch {}
}
