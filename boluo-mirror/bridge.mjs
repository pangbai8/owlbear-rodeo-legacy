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

  const query = (path, params) => api(path + "?" + new URLSearchParams(params));

  // Who speaks, as Boluo's own send would pick it from the channel and the
  // compose box: out of game under the user's name, or in game as the
  // ".as" name or the character set for this channel
  async function speakerFor(channelId) {
    const [me, channel, members] = await Promise.all([
      api("/users/query_self").catch(() => null),
      query("/channels/query", { id: channelId }),
      query("/channels/members", { id: channelId }),
    ]);
    if (!me) throw new Error("请先在 Boluo 窗口里登录");
    const member = members.members.find((m) => m.user.id === me.id);
    if (!member) throw new Error("你不在这个 Boluo 频道里");
    const box = document.querySelector("textarea");
    const mode = composeMode(box ? box.value : "");
    const inGame = mode.inGame ?? channel.type === "IN_GAME";
    const out = { name: me.nickname || me.username, characterId: null, inGame: false };
    if (!inGame) return out;
    const spaceId = member.space.spaceId;
    if (mode.as && mode.as !== "@" && !mode.as.startsWith("@"))
      return { name: mode.as, characterId: null, inGame: true };
    if (mode.as && mode.as.startsWith("@") && mode.as !== "@") {
      const key = mode.as.slice(1);
      const list = await query("/characters/by_space", { spaceId }).catch(() => []);
      const c = list.find((c) => c.key === key || c.name === key || (c.aliases || []).includes(key));
      if (c) return { name: c.name, characterId: c.id, inGame: true };
    }
    const { characterId, characterName } = member.channel;
    if (characterId) {
      const c = await query("/characters/query", { spaceId, characterId }).catch(() => null);
      return { name: (c && c.name) || characterName, characterId, inGame: true };
    }
    return { name: characterName || out.name, characterId: null, inGame: true };
  }

  async function send({ text, entities }) {
    const channelId = openChannelId();
    if (!channelId) throw new Error("请先在 Boluo 窗口里打开一个频道");
    const speaker = await speakerFor(channelId);
    await api("/messages/send", {
      messageId: null,
      previewId: null,
      channelId,
      name: speaker.name,
      characterId: speaker.characterId,
      portraitId: null,
      text,
      entities,
      inGame: speaker.inGame,
      isAction: false,
      mediaId: null,
      whisperToUsers: null,
      pos: null,
      color: "preset:default",
    });
    return speaker;
  }

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (event.source !== window.parent || !origins.includes(event.origin)) return;
    if (!data || data.type !== "boluo-roll" || typeof data.text !== "string") return;
    const reply = (result) =>
      window.parent.postMessage({ type: "boluo-roll-result", id: data.id, ...result }, event.origin);
    try {
      const speaker = await send(data);
      reply({ ok: true, name: speaker.name, inGame: speaker.inGame });
    } catch (e) {
      reply({ ok: false, error: String((e && e.message) || e) });
    }
  });
  // Tell the map page the bridge is up
  for (const origin of origins) window.parent.postMessage({ type: "boluo-bridge-ready" }, origin);
}

// The speaker modifiers at the start of the compose box, as Boluo reads
// them: ".in", ".out", ".as name;" (.as wins); null: not set
export function composeMode(source) {
  let rest = source, inGame = null, as = null, m;
  for (;;) {
    rest = rest.replace(/^\s+/, "");
    if ((m = rest.match(/^[.。]as\b[^\S\r\n]*([^;；\r\n]*?)[^\S\r\n]*(?:[;；]|\r?\n)/i))) {
      as = m[1].trim() || "@";
    } else if ((m = rest.match(/^[.。]as\b/i))) {
      as = "@";
    } else if ((m = rest.match(/^[.。](in|out)\b/i))) {
      inGame = m[1].toLowerCase() === "in";
    } else if ((m = rest.match(/^[.。][a-z]+\b(?:\([^)]*\))?/i))) {
      // .me, .r, .h(…), .mute …: not about who speaks
    } else break;
    rest = rest.slice(m[0].length);
  }
  return { inGame: as ? true : inGame, as };
}

// The Worker's bundler (keep-names) wraps functions in __name(), which the
// page does not have
export function bridgeSource(origins) {
  return `(() => { const __name = (f) => f; const composeMode = ${composeMode}; (${vttBridge})(${JSON.stringify(origins)}); })();`;
}
