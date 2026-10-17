// Runs inside the Boluo page on the mirror (served as /__vtt/bridge.js).
// The Owlbear map page (the iframe's parent, on an allowed origin) asks it
// to post a dice roll; it sends the message with the user's own Boluo
// session to the channel open in the Boluo pane, like typing it in.
export function vttBridge(origins) {
  if (window.parent === window) return;

  // The channel shown in the Boluo panes: the hash holds
  // "panes=[{"type":"CHANNEL","channelId":"…"},…]"
  function openChannelId() {
    try {
      const raw = new URLSearchParams(location.hash.slice(1)).get("panes");
      const panes = JSON.parse(raw || "[]");
      const pane = Array.isArray(panes) && panes.find((p) => p && p.type === "CHANNEL" && p.channelId);
      return pane ? pane.channelId : null;
    } catch (e) {
      return null;
    }
  }

  async function api(path, body) {
    const response = await fetch("/api" + path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    if (data && data.isOk) return data.ok;
    const err = data && data.err;
    throw new Error((err && (err.message || err.code)) || "HTTP " + response.status);
  }

  let nickname = null;
  async function send({ speaker, text, entities }) {
    const channelId = openChannelId();
    if (!channelId) throw new Error("请先在 Boluo 窗口里打开一个频道");
    if (!speaker && !nickname) {
      const me = await api("/users/query_self").catch(() => null);
      if (!me) throw new Error("请先在 Boluo 窗口里登录");
      nickname = me.nickname || me.username;
    }
    await api("/messages/send", {
      messageId: null,
      previewId: null,
      channelId,
      // A monster speaks in game under its name; other rolls are out of game
      name: speaker || nickname,
      characterId: null,
      portraitId: null,
      text,
      entities,
      inGame: !!speaker,
      isAction: false,
      mediaId: null,
      whisperToUsers: null,
      pos: null,
      color: "preset:default",
    });
  }

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (event.source !== window.parent || !origins.includes(event.origin)) return;
    if (!data || data.type !== "boluo-roll" || typeof data.text !== "string") return;
    const reply = (result) =>
      window.parent.postMessage({ type: "boluo-roll-result", id: data.id, ...result }, event.origin);
    try {
      await send(data);
      reply({ ok: true });
    } catch (e) {
      reply({ ok: false, error: String((e && e.message) || e) });
    }
  });
  // Tell the map page the bridge is up
  for (const origin of origins) window.parent.postMessage({ type: "boluo-bridge-ready" }, origin);
}

// The Worker's bundler (keep-names) wraps functions in __name(), which the
// page does not have
export function bridgeSource(origins) {
  return `(() => { const __name = (f) => f; (${vttBridge})(${JSON.stringify(origins)}); })();`;
}
