// Same-site reverse proxy for the Boluo frontend (AGPL-3.0, https://github.com/mythal/boluo).
// Served on a pangbai.de subdomain so the Boluo session cookie is first-party
// when the chat is embedded in the Owlbear map page.
const UPSTREAM = "https://app.boluochat.com";

// Drop Domain (cookie becomes host-only on the mirror) and force Secure.
export function rewriteSetCookie(cookie) {
  const [pair, ...attrs] = cookie.split(";").map((part) => part.trim());
  const kept = attrs.filter((attr) => {
    const name = attr.split("=")[0].toLowerCase();
    return name !== "domain" && name !== "secure";
  });
  return [pair, ...kept, "Secure"].join("; ");
}

export function rewriteLocation(location, mirrorOrigin) {
  try {
    const url = new URL(location);
    if (url.hostname === "boluochat.com" || url.hostname.endsWith(".boluochat.com")) {
      const mirror = new URL(mirrorOrigin);
      url.protocol = mirror.protocol;
      url.host = mirror.host;
      return url.toString();
    }
  } catch {}
  return location;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // The SPA probes these proxies and may switch its API base to one of them;
    // they are cross-site to the mirror, so the session cookie would not follow.
    if (url.pathname === "/api/info/proxies")
      return Response.json([], { headers: { "Cache-Control": "no-store" } });
    const target = new URL(url.pathname + url.search, UPSTREAM);
    const upstreamRequest = new Request(target, request);
    const response = await fetch(upstreamRequest, { redirect: "manual" });
    if (response.status === 101) return response;

    const headers = new Headers(response.headers);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) {
      headers.delete("Set-Cookie");
      for (const cookie of cookies) headers.append("Set-Cookie", rewriteSetCookie(cookie));
    }
    const location = headers.get("Location");
    if (location) headers.set("Location", rewriteLocation(location, url.origin));
    headers.set("X-Boluo-Mirror", "1");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
