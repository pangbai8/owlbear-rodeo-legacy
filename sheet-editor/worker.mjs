// Static host for ranuts/document (AGPL-3.0, https://github.com/ranuts/document).
// The x2t converter ships as pre-compressed Brotli; it only loads when served
// with Content-Encoding: br and passed through without re-encoding.
const BROTLI_ASSETS = ["/sdkjs/common/wasm/x2t/x2t.wasm.br"];

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const { pathname } = new URL(request.url);
    if (!BROTLI_ASSETS.includes(pathname) || !response.ok) return response;
    const headers = new Headers(response.headers);
    headers.set("Content-Encoding", "br");
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(response.body, {
      status: response.status,
      headers,
      encodeBody: "manual",
    });
  },
};
