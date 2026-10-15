// Signed session cookies (HMAC-SHA256) and small cookie helpers.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE = "db_session";
export const STATE_COOKIE = "db_oauth_state";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function randomToken(bytes = 24) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** `payload.exp` is a unix time in milliseconds */
export async function signSession(payload, secret) {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export async function verifySession(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64url(signature),
      encoder.encode(body),
    );
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(fromBase64url(body)));
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    if (typeof payload.uid !== "string" || !/^\d+$/.test(payload.uid)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of (header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name && !(name in cookies)) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

export function serializeCookie(name, value, { maxAge, path = "/" } = {}) {
  const parts = [`${name}=${value}`, `Path=${path}`, "HttpOnly", "Secure", "SameSite=Lax"];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}
