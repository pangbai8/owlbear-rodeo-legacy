// Discord chat bridge for the Owlbear map page. Serves a small chat page,
// signs players in with Discord OAuth, and forwards API / WebSocket calls to
// the Hub Durable Object. Must be served on the same site as the VTT
// (e.g. discord.pangbai.de next to vtt.pangbai.de) so the session cookie
// still reaches the page when it is embedded in an iframe.
import { API, DiscordError, discordRequest, memberAllowed, readConfig } from "./discord.mjs";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  STATE_COOKIE,
  parseCookies,
  randomToken,
  serializeCookie,
  signSession,
  verifySession,
} from "./session.mjs";

export { Hub } from "./hub.mjs";

const DONE_PAGE = "/auth-done.html";

export function contentSecurityPolicy(frameAncestors) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob: https://*.discordapp.com https://*.discordapp.net",
    "media-src 'self' blob: https://*.discordapp.com https://*.discordapp.net",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${["'self'", ...frameAncestors].join(" ")}`,
  ].join("; ");
}

function withSecurityHeaders(response, config) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy(config.frameAncestors));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function redirectUri(url) {
  return `${url.origin}/auth/callback`;
}

function login(url, config) {
  const state = randomToken();
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri(url),
    scope: "identify",
    state,
    prompt: "none",
  }).toString();
  return redirect(authorize.toString(), [serializeCookie(STATE_COOKIE, state, { maxAge: 600, path: "/auth" })]);
}

async function callback(request, url, env, config) {
  const done = (error) => redirect(`${DONE_PAGE}${error ? `?error=${error}` : ""}`, [
    serializeCookie(STATE_COOKIE, "", { maxAge: 0, path: "/auth" }),
  ]);
  const state = url.searchParams.get("state");
  const expected = parseCookies(request.headers.get("Cookie"))[STATE_COOKIE];
  if (url.searchParams.get("error")) return done("denied");
  if (!state || !expected || state !== expected) return done("state");
  const code = url.searchParams.get("code");
  if (!code) return done("state");

  let user;
  try {
    const tokenResponse = await fetch(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(url),
      }),
    });
    if (!tokenResponse.ok) return done("token");
    const token = await tokenResponse.json();
    user = await discordRequest(env, "/users/@me", { auth: `Bearer ${token.access_token}` });
  } catch (e) {
    console.error("oauth failed", e);
    return done("token");
  }

  try {
    const member = await discordRequest(env, `/guilds/${config.guildId}/members/${user.id}`).catch((e) => {
      if (e instanceof DiscordError && e.status === 404) return null;
      throw e;
    });
    if (!member) return done("not_member");
    if (!memberAllowed(member, config.allowedRoleIds)) return done("missing_role");
  } catch (e) {
    console.error("member lookup failed", e);
    return done("server");
  }

  const session = await signSession({ uid: user.id, exp: Date.now() + SESSION_TTL_SECONDS * 1000 }, env.SESSION_SECRET);
  const response = done(null);
  response.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, session, { maxAge: SESSION_TTL_SECONDS }));
  return response;
}

/** Browsers send Origin on WebSocket and non-GET requests; only accept our own page */
function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  return origin === url.origin;
}

export default {
  async fetch(request, env) {
    const response = await handle(request, env);
    // Drain bodies of rejected requests: replying before a body is read resets the connection
    if (request.body && !request.bodyUsed) await request.arrayBuffer().catch(() => {});
    return response;
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const config = readConfig(env);

  if (url.pathname === "/health") return Response.json({ ok: true });
  if (url.pathname === "/auth/login") return login(url, config);
  if (url.pathname === "/auth/callback") return callback(request, url, env, config);
  if (url.pathname === "/auth/logout") {
    if (request.method !== "POST" || !sameOrigin(request, url)) return new Response("Method not allowed", { status: 405 });
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": serializeCookie(SESSION_COOKIE, "", { maxAge: 0 }) },
    });
  }

  if (url.pathname === "/ws" || url.pathname.startsWith("/api/")) {
    if ((url.pathname === "/ws" || request.method !== "GET") && !sameOrigin(request, url))
      return Response.json({ error: "bad_origin" }, { status: 403 });
    const session = await verifySession(parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE], env.SESSION_SECRET);
    if (!session) return Response.json({ error: "unauthorized", message: "未登录" }, { status: 401 });
    const forwarded = new Request(request);
    forwarded.headers.set("X-Bridge-User", session.uid);
    return env.HUB.get(env.HUB.idFromName("hub")).fetch(forwarded);
  }

  return withSecurityHeaders(await env.ASSETS.fetch(request), config);
}
