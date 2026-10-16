import { createCharacterPanel } from "./characters.js";
import { renderMarkdown } from "./markdown.js";
import { characterDisplayName, matchProxy } from "./proxy.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const GROUP_WINDOW_MS = 7 * 60 * 1000;
const CHANNEL_KEY = "discord-bridge.channel";
const IDENTITY_KEY = "discord-bridge.identity";

const $ = (id) => document.getElementById(id);
const scroller = $("scroller");
const list = $("messages");
const input = $("input");

const state = {
  me: null,
  channels: [],
  names: { channels: {}, roles: {} },
  channelId: null,
  messages: new Map(),
  order: [],
  hasMore: true,
  loadingOlder: false,
  editing: null, // { id, draft }
  files: [],
  socket: null,
  retry: 0,
  stick: true,
  sending: false,
  gateway: "connecting",
  characters: [],
  identity: "", // "" = yourself, otherwise a character id
};

let characterPanel = null;

// ---- helpers ---------------------------------------------------------------

class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || `HTTP ${status}`);
    this.status = status;
    this.code = data?.error;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

// The VTT page embedding this one sends dice rolls from its 5e stat cards to
// the channel open here, as the signed-in user. Only that parent may ask
// (and only the sites in FRAME_ANCESTORS can embed this page).
window.addEventListener("message", async (event) => {
  const data = event.data;
  if (data?.type !== "bridge-send" || window.parent === window || event.source !== window.parent) return;
  const ancestor = location.ancestorOrigins?.[0];
  if (ancestor && ancestor !== event.origin) return;
  const reply = (payload) =>
    event.source.postMessage({ type: "bridge-send-result", id: data.id, ...payload }, event.origin);
  if (!state.channelId) return reply({ error: "请先在 Discord 窗口里登录并选一个频道" });
  try {
    const result = await api(`/api/channels/${state.channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: String(data.content || ""), speaker: data.speaker || null }),
    });
    state.stick = true;
    upsert([result.message]);
    reply({ ok: true });
  } catch (error) {
    reply({ error: error.message });
  }
});

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key.startsWith("data-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

const compareIds = (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fullTime(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const time = shortTime(iso);
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return `${date.toLocaleDateString()} ${time}`;
}

function showScreen(name) {
  for (const id of ["login", "loading", "chat"]) $(id).hidden = id !== name;
}

// ---- auth ------------------------------------------------------------------

let loginWait = null;

function showLogin(message) {
  closeSocket();
  $("login-message").textContent = message || "用 Discord 账号登录后就能在这里收发消息。";
  showScreen("login");
}

function stopLoginWait() {
  if (!loginWait) return;
  clearInterval(loginWait.timer);
  loginWait.channel?.close();
  window.removeEventListener("message", loginWait.onMessage);
  loginWait = null;
}

function onLoginResult(result) {
  if (result?.type !== "discord-bridge-login") return;
  stopLoginWait();
  if (result.ok) start();
  else if (result.error === "not_member") showLogin("你不在这个 Discord 服务器里，请先加入服务器。");
  else if (result.error === "missing_role") showLogin("你没有使用这个聊天窗口所需的身份组。");
  else showLogin("登录没有完成，请重试。");
}

function login() {
  const popup = window.open("/auth/login", "discord-bridge-login", "popup,width=520,height=760");
  if (!popup) {
    $("login-message").textContent = "登录弹窗被浏览器拦截了，请允许弹出窗口后重试。";
    return;
  }
  stopLoginWait();
  const started = Date.now();
  const onMessage = (event) => {
    if (event.origin === location.origin) onLoginResult(event.data);
  };
  let channel = null;
  try {
    channel = new BroadcastChannel("discord-bridge-auth");
    channel.onmessage = (event) => onLoginResult(event.data);
  } catch {}
  window.addEventListener("message", onMessage);
  // Fallback when neither message arrives (e.g. the popup lost its opener)
  const timer = setInterval(async () => {
    if (Date.now() - started > 5 * 60 * 1000) return stopLoginWait();
    try {
      await api("/api/me");
      stopLoginWait();
      start();
    } catch {}
  }, 2000);
  loginWait = { timer, channel, onMessage };
}

async function logout() {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  state.me = null;
  showLogin("已退出登录。");
}

// ---- startup ---------------------------------------------------------------

async function start() {
  showScreen("loading");
  try {
    const me = await api("/api/me");
    initChat(me);
  } catch (error) {
    if (error.status === 401) showLogin();
    else if (error.status === 403) showLogin(error.message);
    else {
      showLogin(`连接失败：${error.message}`);
      $("login-button").textContent = "重试";
      $("login-button").onclick = () => {
        $("login-button").textContent = "用 Discord 登录";
        $("login-button").onclick = login;
        start();
      };
    }
  }
}

function initChat(me) {
  state.me = me.user;
  state.channels = me.channels;
  state.names = me.names;
  state.gateway = me.gateway;
  $("me-avatar").src = me.user.avatar;
  $("me-avatar").title = me.user.name;

  const guilds = [];
  for (const c of me.channels) if (!guilds.some((g) => g.id === c.guildId)) guilds.push({ id: c.guildId, name: c.guildName });
  $("guild-select").replaceChildren(...guilds.map((g) => el("option", { value: g.id, text: g.name })));
  // Always shown, so it is clear which server the channel belongs to
  $("guild-select").hidden = false;

  state.identity = safeStorage("get", IDENTITY_KEY) || "";
  characterPanel ??= createCharacterPanel({ api, getMe: () => state.me, onChange: setCharacters });
  renderIdentity();
  characterPanel.load().catch((error) => showComposerError(`加载角色失败：${error.message}`));

  const wanted = new URLSearchParams(location.search).get("channel") || safeStorage("get", CHANNEL_KEY);
  const channel = me.channels.find((c) => c.id === wanted) || me.channels.find((c) => c.access.send) || me.channels[0];
  showScreen("chat");
  switchChannel(channel.id);
}

function safeStorage(op, key, value) {
  try {
    return op === "get" ? localStorage.getItem(key) : localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

function switchChannel(channelId) {
  state.channelId = channelId;
  state.messages.clear();
  state.order = [];
  state.hasMore = true;
  state.editing = null;
  state.stick = true;
  const channel = state.channels.find((c) => c.id === channelId);
  renderChannelOptions(channel.guildId);
  $("guild-select").value = channel.guildId;
  $("channel-select").value = channelId;
  const single = state.channels.filter((c) => c.guildId === channel.guildId).length < 2;
  $("channel-name").textContent = single ? `# ${channel?.name || ""}` : "";
  $("channel-name").title = channel?.guildName || "";
  safeStorage("set", CHANNEL_KEY, channelId);
  safeStorage("set", `${CHANNEL_KEY}.${channel.guildId}`, channelId);
  applyAccess(channel?.access);
  renderIdentity();
  render();
  connect();
}

/** Channels of one server, grouped by category like the Discord sidebar */
function renderChannelOptions(guildId) {
  const channels = state.channels.filter((c) => c.guildId === guildId);
  const option = (c) => el("option", { value: c.id, text: `# ${c.name}` });
  const groups = [];
  for (const c of channels) {
    const group = groups.at(-1);
    if (group && group.category === c.category) group.channels.push(c);
    else groups.push({ category: c.category, channels: [c] });
  }
  $("channel-select").replaceChildren(
    ...groups.map((g) => (g.category ? el("optgroup", { label: g.category }, g.channels.map(option)) : g.channels.map(option))).flat(),
  );
  $("channel-select").hidden = channels.length < 2;
}

function currentChannel() {
  return state.channels.find((c) => c.id === state.channelId);
}

/** Mirrors the Discord permissions of this channel: read-only, no uploads, ... */
function applyAccess(access) {
  const channel = currentChannel();
  if (channel && access) channel.access = access;
  const canSend = !!access?.send;
  input.disabled = !canSend;
  $("send-button").disabled = !canSend;
  $("identity-select").disabled = !canSend;
  input.placeholder = canSend
    ? `发送到 #${channel?.name || ""}`
    : access?.botCannotPost
      ? "机器人在这个频道不能发言（缺少「管理 Webhook」权限），只能看"
      : "你在这个频道没有发言权限（只能看）";
  document.querySelector(".attach").hidden = !access?.attach;
  if (!access?.attach && state.files.length) {
    state.files = [];
    renderFiles();
  }
}

// ---- socket ----------------------------------------------------------------

function setStatus(gateway) {
  state.gateway = gateway;
  const status = $("status");
  status.className = `status ${gateway}`;
  status.title =
    {
      ready: "已连接 Discord",
      connecting: "正在连接 Discord…",
      idle: "正在连接 Discord…",
      fatal: "机器人无法连接 Discord，请联系管理员检查 Token 和 Intents",
      offline: "与聊天服务器断开，正在重连…",
    }[gateway] || gateway;
}

function closeSocket() {
  const socket = state.socket;
  state.socket = null;
  if (!socket) return;
  clearInterval(socket.pingTimer);
  try {
    socket.close();
  } catch {}
}

function connect() {
  closeSocket();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws?channel=${state.channelId}`);
  state.socket = socket;
  setStatus("connecting");

  socket.onopen = () => {
    state.retry = 0;
    socket.pingTimer = setInterval(() => socket.readyState === 1 && socket.send("ping"), 30000);
    loadLatest();
  };
  socket.onmessage = (event) => {
    if (event.data === "pong" || state.socket !== socket) return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "status") setStatus(message.state);
    else if (message.type === "upsert") upsert([message.message], { live: true });
    else if (message.type === "delete") removeMessages(message.ids);
    else if (message.type === "resync") loadLatest();
    else if (message.type === "access") applyAccess(message.access);
  };
  socket.onclose = async (event) => {
    clearInterval(socket.pingTimer);
    if (state.socket !== socket) return;
    state.socket = null;
    setStatus("offline");
    if (event.code === 4003) {
      showComposerError("你已经没有这个频道的权限了");
      return start();
    }
    // The upgrade fails silently when the session expired; check before retrying
    try {
      await api("/api/me");
    } catch (error) {
      if (error.status === 401) return showLogin("登录已过期，请重新登录。");
      if (error.status === 403) return showLogin(error.message);
    }
    const delay = Math.min(30000, 1000 * 2 ** state.retry++);
    setTimeout(() => {
      if (!state.socket && state.me && state.channelId) connect();
    }, delay);
  };
}

// ---- messages --------------------------------------------------------------

function sortOrder() {
  state.order = [...state.messages.keys()].sort(compareIds);
}

function upsert(messages, { live = false } = {}) {
  let added = false;
  for (const message of messages) {
    if (message.channelId && message.channelId !== state.channelId) continue;
    if (!state.messages.has(message.id)) added = true;
    state.messages.set(message.id, { ...state.messages.get(message.id), ...message });
  }
  sortOrder();
  render();
  if (live && added && !state.stick) $("jump").hidden = false;
}

function removeMessages(ids) {
  let changed = false;
  for (const id of ids) {
    changed = state.messages.delete(id) || changed;
    if (state.editing?.id === id) state.editing = null;
  }
  if (!changed) return;
  sortOrder();
  render();
}

async function loadLatest() {
  const channelId = state.channelId;
  try {
    const data = await api(`/api/channels/${channelId}/messages`);
    if (channelId !== state.channelId) return;
    $("older").hidden = !data.noHistory;
    if (data.noHistory) $("older").textContent = "你在这个频道没有「阅读消息历史」权限，只能看到之后的新消息";
    const fresh = new Set(data.messages.map((m) => m.id));
    const oldest = data.messages[0]?.id;
    // Anything in the refreshed range that is gone was deleted while we were away
    for (const id of state.order) {
      if (!fresh.has(id) && (!oldest || compareIds(id, oldest) >= 0)) state.messages.delete(id);
    }
    if (state.order.length === 0 || !oldest) state.hasMore = data.hasMore;
    upsert(data.messages);
    fillViewport();
  } catch (error) {
    if (error.status === 401) showLogin("登录已过期，请重新登录。");
    else showComposerError(`加载消息失败：${error.message}`);
  }
}

async function loadOlder() {
  if (state.loadingOlder || !state.hasMore || !state.order.length) return;
  const channelId = state.channelId;
  state.loadingOlder = true;
  $("older").textContent = "正在加载更早的消息…";
  $("older").hidden = false;
  try {
    const data = await api(`/api/channels/${channelId}/messages?before=${state.order[0]}`);
    if (channelId !== state.channelId) return;
    state.hasMore = data.hasMore;
    for (const message of data.messages) state.messages.set(message.id, message);
    sortOrder();
    render({ keepBottomDistance: true });
  } catch (error) {
    showComposerError(`加载更早的消息失败：${error.message}`);
  } finally {
    state.loadingOlder = false;
    $("older").hidden = true;
  }
  fillViewport();
}

/** Keep loading history until the list can scroll */
function fillViewport() {
  if (state.hasMore && scroller.scrollHeight <= scroller.clientHeight + 40) loadOlder();
}

// ---- rendering -------------------------------------------------------------

function mentionContext(message) {
  const users = {};
  for (const mention of message.mentions || []) users[mention.id] = mention.name;
  if (state.me) users[state.me.id] ??= state.me.name;
  return { users, roles: state.names.roles, channels: state.names.channels };
}

function isJumbo(content) {
  const stripped = content.replace(/<a?:\w+:\d+>/g, "").replace(/\s/g, "");
  const count = (content.match(/<a?:\w+:\d+>/g) || []).length;
  if (count === 0 && stripped) {
    // Unicode-only emoji messages
    return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️){1,27}$/u.test(stripped) && !/^[\d#*]+$/.test(stripped);
  }
  return count > 0 && count <= 27 && !stripped;
}

function mediaSize(width, height, maxWidth = 360, maxHeight = 300) {
  if (!width || !height) return {};
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: `${Math.round(width * scale)}px`, aspectRatio: `${width} / ${height}`, height: "auto", maxHeight: "none" };
}

function renderAttachment(a) {
  const type = a.contentType;
  const isImage = type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/i.test(a.filename);
  if (isImage) {
    return el("img", {
      src: a.proxyUrl || a.url,
      alt: a.filename,
      loading: "lazy",
      class: a.spoiler ? "spoiler-media" : "",
      "data-full": a.url,
      style: mediaSize(a.width, a.height),
    });
  }
  if (type.startsWith("video/")) return el("video", { src: a.url, controls: true, preload: "metadata", style: mediaSize(a.width, a.height) });
  if (type.startsWith("audio/")) return el("audio", { src: a.url, controls: true, preload: "none" });
  return el("a", { class: "file", href: a.url, target: "_blank", rel: "noopener noreferrer" }, [
    el("span", { text: `📄 ${a.filename}` }),
    el("span", { class: "size", text: formatSize(a.size) }),
  ]);
}

function renderEmbed(e, message) {
  const ctx = mentionContext(message);
  if ((e.type === "image" || e.type === "gifv") && (e.thumbnail || e.video)) {
    if (e.type === "gifv" && e.video)
      return el("video", { class: "embed-media", src: e.video.url, autoplay: true, loop: true, muted: true, playsInline: true, style: mediaSize(e.video.width, e.video.height) });
    return el("img", { class: "embed-media", src: e.thumbnail.url, loading: "lazy", "data-full": e.thumbnail.url, style: mediaSize(e.thumbnail.width, e.thumbnail.height) });
  }
  const parts = [];
  if (e.provider) parts.push(el("div", { class: "provider", text: e.provider }));
  if (e.author?.name)
    parts.push(el("div", { class: "author" }, [e.author.iconUrl && el("img", { src: e.author.iconUrl, alt: "" }), el("span", { text: e.author.name })]));
  if (e.title)
    parts.push(
      e.url && /^https?:\/\//.test(e.url)
        ? el("a", { class: "title", href: e.url, target: "_blank", rel: "noopener noreferrer", text: e.title })
        : el("div", { class: "title", text: e.title }),
    );
  if (e.description) parts.push(el("div", { class: "description", html: renderMarkdown(e.description, ctx) }));
  if (e.fields.length)
    parts.push(
      el(
        "div",
        { class: "fields" },
        e.fields.map((f) =>
          el("div", { class: `field${f.inline ? " inline" : ""}` }, [
            el("div", { class: "field-name", html: renderMarkdown(f.name, ctx) }),
            el("div", { class: "field-value", html: renderMarkdown(f.value, ctx) }),
          ]),
        ),
      ),
    );
  if (e.image) parts.push(el("img", { class: "embed-media", src: e.image.url, loading: "lazy", "data-full": e.image.url, style: mediaSize(e.image.width, e.image.height, 400, 300) }));
  else if (e.video && e.thumbnail) parts.push(el("img", { class: "embed-media", src: e.thumbnail.url, loading: "lazy", style: mediaSize(e.thumbnail.width, e.thumbnail.height) }));
  else if (e.thumbnail) parts.push(el("img", { class: "embed-thumb", src: e.thumbnail.url, loading: "lazy", "data-full": e.thumbnail.url }));
  if (e.footer?.text) parts.push(el("div", { class: "footer", text: e.footer.text }));
  if (!parts.length) return null;
  const style = e.color !== null ? { "--embed-color": `#${e.color.toString(16).padStart(6, "0")}` } : {};
  const node = el("div", { class: "embed" }, parts);
  for (const [key, value] of Object.entries(style)) node.style.setProperty(key, value);
  return node;
}

function renderBody(message) {
  if (message.system !== null) {
    return el("div", { class: "body", text: `${message.author.name} ${message.system || "（系统消息）"}` });
  }
  if (state.editing?.id === message.id) {
    const textarea = el("textarea", { class: "edit-input", value: state.editing.draft, rows: 2, maxLength: 2000 });
    return el("div", { class: "edit-box" }, [textarea, el("div", { class: "edit-hint", text: "Enter 保存 · Shift+Enter 换行 · Esc 取消" })]);
  }
  if (!message.content) return null;
  const body = el("div", { class: `body${isJumbo(message.content) ? " jumbo" : ""}`, html: renderMarkdown(message.content, mentionContext(message)) });
  if (message.editedTimestamp) body.append(el("span", { class: "edited", text: "(已编辑)", title: fullTime(message.editedTimestamp) }));
  return body;
}

function renderMessage(message, continued) {
  const own = state.me && message.ownerId === state.me.id;
  const item = el("li", { class: `msg${continued ? " cont" : ""}${message.system !== null ? " system" : ""}`, "data-id": message.id });
  const side = el("div", { class: "side" }, continued ? el("span", { class: "time", text: shortTime(message.timestamp) }) : el("img", { class: "avatar", src: message.author.avatar, alt: "", loading: "lazy" }));
  const content = el("div", { class: "content" });

  if (message.reference) {
    content.append(el("div", { class: "reply", text: message.reference.author ? `${message.reference.author}: ${message.reference.content || "（附件）"}` : "回复了一条消息" }));
  }
  if (message.interaction) {
    content.append(el("div", { class: "interaction", text: `${message.interaction.user} 使用了 /${message.interaction.name}` }));
  }
  if (!continued) {
    // Messages sent from this page are players, not bots
    const tag = message.ownerId ? null : message.author.webhook ? "APP" : message.author.bot ? "BOT" : null;
    content.append(
      el("div", { class: "head" }, [
        el("span", { class: "name", text: message.author.name }),
        tag && el("span", { class: "tag", text: tag }),
        el("span", { class: "time-full", text: fullTime(message.timestamp), title: new Date(message.timestamp).toLocaleString() }),
      ]),
    );
  }
  content.append(renderBody(message) || "");
  if (message.attachments.length) content.append(el("div", { class: "attachments" }, message.attachments.map(renderAttachment)));
  if (message.embeds.length) {
    const embeds = message.embeds.map((e) => renderEmbed(e, message)).filter(Boolean);
    if (embeds.length) content.append(el("div", { class: "embeds" }, embeds));
  }
  if (message.stickers.length)
    content.append(el("div", { class: "stickers" }, message.stickers.map((s) => el("img", { src: s.url, alt: s.name, title: s.name, loading: "lazy" }))));

  item.append(side, content);
  if (own && state.editing?.id !== message.id) {
    item.append(
      el("div", { class: "actions" }, [
        el("button", { type: "button", "data-action": "edit", text: "编辑", title: "编辑" }),
        el("button", { type: "button", "data-action": "delete", class: "danger", text: "删除", title: "删除" }),
      ]),
    );
  }
  return item;
}

function canGroup(previous, message) {
  if (!previous || previous.system !== null || message.system !== null) return false;
  if (message.reference || message.interaction) return false;
  if (previous.author.id !== message.author.id || previous.author.name !== message.author.name) return false;
  if (new Date(previous.timestamp).toDateString() !== new Date(message.timestamp).toDateString()) return false;
  return new Date(message.timestamp) - new Date(previous.timestamp) < GROUP_WINDOW_MS;
}

function render({ keepBottomDistance = false } = {}) {
  const fromBottom = scroller.scrollHeight - scroller.scrollTop;
  const top = scroller.scrollTop;
  const editFocused = document.activeElement?.classList?.contains("edit-input");
  const selection = editFocused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;

  const fragment = document.createDocumentFragment();
  let previous = null;
  for (const id of state.order) {
    const message = state.messages.get(id);
    const day = new Date(message.timestamp).toDateString();
    if (!previous || new Date(previous.timestamp).toDateString() !== day) {
      fragment.append(el("li", { class: "day", text: new Date(message.timestamp).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", weekday: "short" }) }));
    }
    fragment.append(renderMessage(message, canGroup(previous, message)));
    previous = message;
  }
  list.replaceChildren(fragment);

  const editor = list.querySelector(".edit-input");
  if (editor && (editFocused || state.editing?.focus)) {
    editor.focus();
    if (selection) editor.setSelectionRange(...selection);
    else editor.setSelectionRange(editor.value.length, editor.value.length);
    state.editing.focus = false;
  }

  if (state.stick) scrollToBottom();
  else if (keepBottomDistance) scroller.scrollTop = scroller.scrollHeight - fromBottom;
  else scroller.scrollTop = top;
}

function scrollToBottom() {
  scroller.scrollTop = scroller.scrollHeight;
  $("jump").hidden = true;
}

// ---- editing and deleting ---------------------------------------------------

function startEdit(id) {
  const message = state.messages.get(id);
  if (!message || message.ownerId !== state.me?.id) return;
  state.editing = { id, draft: message.content, focus: true };
  render();
}

function cancelEdit() {
  state.editing = null;
  render();
  input.focus();
}

async function saveEdit() {
  const editing = state.editing;
  if (!editing) return;
  const message = state.messages.get(editing.id);
  const content = editing.draft.trim();
  if (!message || content === message.content.trim()) return cancelEdit();
  if (!content) {
    if (message.attachments.length === 0) return deleteMessage(editing.id);
    return showComposerError("带附件的消息不能把文字改成空的");
  }
  try {
    const data = await api(`/api/channels/${state.channelId}/messages/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    state.editing = null;
    upsert([data.message]);
    input.focus();
  } catch (error) {
    showComposerError(`编辑失败：${error.message}`);
  }
}

async function deleteMessage(id) {
  if (!confirm("确定删除这条消息吗？Discord 里也会一起删除。")) return;
  try {
    await api(`/api/channels/${state.channelId}/messages/${id}`, { method: "DELETE" });
    removeMessages([id]);
  } catch (error) {
    showComposerError(`删除失败：${error.message}`);
  }
}

list.addEventListener("click", (event) => {
  const target = event.target;
  const spoiler = target.closest(".spoiler");
  if (spoiler) return spoiler.classList.add("revealed");
  if (target.matches("img.spoiler-media")) return target.classList.remove("spoiler-media");
  if (target.matches("img[data-full]")) return openLightbox(target.dataset.full);
  const action = target.closest("[data-action]")?.dataset.action;
  const id = target.closest(".msg")?.dataset.id;
  if (action === "edit") startEdit(id);
  else if (action === "delete") deleteMessage(id);
});

list.addEventListener("input", (event) => {
  if (event.target.classList.contains("edit-input") && state.editing) state.editing.draft = event.target.value;
});

list.addEventListener("keydown", (event) => {
  if (!event.target.classList.contains("edit-input")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    cancelEdit();
  } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    saveEdit();
  }
});

list.addEventListener(
  "load",
  (event) => {
    if (event.target.tagName === "IMG" && state.stick) scrollToBottom();
  },
  true,
);

function openLightbox(src) {
  const box = el("div", { class: "lightbox" }, el("img", { src, alt: "" }));
  box.addEventListener("click", () => box.remove());
  document.addEventListener("keydown", function close(event) {
    if (event.key === "Escape") {
      box.remove();
      document.removeEventListener("keydown", close);
    }
  });
  document.body.append(box);
}

// ---- identity (characters) ---------------------------------------------------

function setCharacters(characters) {
  state.characters = characters;
  if (state.identity && !characters.some((c) => c.id === state.identity)) state.identity = "";
  renderIdentity();
}

function renderIdentity() {
  const select = $("identity-select");
  const self = currentChannel()?.self || state.me;
  const options = [el("option", { value: "", text: `${self?.name || "我"}（自己）` })];
  for (const c of state.characters) options.push(el("option", { value: c.id, text: characterDisplayName(c) }));
  select.replaceChildren(...options);
  select.value = state.identity;
  updateIdentityHint();
}

/** Who the message in the input will be sent as: brackets win over the picker */
function currentIdentity() {
  const proxied = matchProxy(input.value.trim(), state.characters);
  if (proxied) return { character: proxied.character, viaBrackets: true };
  return { character: state.characters.find((c) => c.id === state.identity) || null, viaBrackets: false };
}

function updateIdentityHint() {
  const { character, viaBrackets } = currentIdentity();
  $("identity-avatar").src = character?.avatarUrl || (currentChannel()?.self || state.me)?.avatar || "";
  const hint = $("proxy-hint");
  hint.textContent = viaBrackets ? `括号 → 以「${characterDisplayName(character)}」发送` : "";
  hint.classList.toggle("active", viaBrackets);
}

$("identity-select").addEventListener("change", (event) => {
  state.identity = event.target.value;
  safeStorage("set", IDENTITY_KEY, state.identity);
  updateIdentityHint();
  input.focus();
});
$("characters-button").addEventListener("click", () => characterPanel?.open());

// Help: how this works and how to invite the bot (also from the login screen)
function openHelp() {
  $("help").hidden = false;
  $("help-close").focus();
}
function closeHelp() {
  $("help").hidden = true;
}
$("help-button").addEventListener("click", openHelp);
$("help-open-login").addEventListener("click", openHelp);
$("help-close").addEventListener("click", closeHelp);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("help").hidden) closeHelp();
});

// ---- composer --------------------------------------------------------------

function showComposerError(message) {
  const node = $("composer-error");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(showComposerError.timer);
  showComposerError.timer = setTimeout(() => (node.hidden = true), 6000);
}

function autosize() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + 2}px`;
}

function renderFiles() {
  $("pending-files").replaceChildren(
    ...state.files.map((file, index) =>
      el("span", { class: "chip" }, [
        el("span", { text: `${file.name} (${formatSize(file.size)})` }),
        el("button", { type: "button", "data-remove": index, text: "×", title: "移除" }),
      ]),
    ),
  );
}

function addFiles(files) {
  for (const file of files) if (file.size > 0) state.files.push(file);
  state.files = state.files.slice(0, 10);
  renderFiles();
}

async function send() {
  if (state.sending) return;
  const content = input.value;
  const files = state.files;
  if (!content.trim() && !files.length) return;
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD_BYTES) return showComposerError("文件总大小不能超过 10MB");

  let body;
  let headers;
  if (files.length) {
    body = new FormData();
    body.set("content", content);
    body.set("characterId", state.identity);
    for (const file of files) body.append("files", file, file.name);
  } else {
    body = JSON.stringify({ content, characterId: state.identity });
    headers = { "Content-Type": "application/json" };
  }

  state.sending = true;
  $("send-button").disabled = true;
  try {
    const data = await api(`/api/channels/${state.channelId}/messages`, { method: "POST", headers, body });
    input.value = "";
    updateIdentityHint();
    state.files = [];
    renderFiles();
    autosize();
    state.stick = true;
    upsert([data.message]);
  } catch (error) {
    showComposerError(`发送失败：${error.message}`);
  } finally {
    state.sending = false;
    $("send-button").disabled = false;
    input.focus();
  }
}

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  send();
});

input.addEventListener("input", () => {
  autosize();
  updateIdentityHint();
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  } else if (event.key === "ArrowUp" && !input.value) {
    const lastOwn = [...state.order].reverse().find((id) => state.messages.get(id).ownerId === state.me?.id);
    if (lastOwn) {
      event.preventDefault();
      startEdit(lastOwn);
    }
  }
});
input.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (files.length) {
    event.preventDefault();
    addFiles(files);
  }
});

$("file-input").addEventListener("change", (event) => {
  addFiles([...event.target.files]);
  event.target.value = "";
});

$("pending-files").addEventListener("click", (event) => {
  const index = event.target.dataset.remove;
  if (index === undefined) return;
  state.files.splice(Number(index), 1);
  renderFiles();
});

$("chat").addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
$("chat").addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  addFiles([...event.dataTransfer.files]);
});

// ---- misc wiring ------------------------------------------------------------

scroller.addEventListener("scroll", () => {
  state.stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  if (state.stick) $("jump").hidden = true;
  if (scroller.scrollTop < 200) loadOlder();
});

$("jump-button").addEventListener("click", () => {
  state.stick = true;
  scrollToBottom();
});

$("channel-select").addEventListener("change", (event) => switchChannel(event.target.value));
// Switching servers opens the last channel used there, or its first channel
$("guild-select").addEventListener("change", (event) => {
  const guildId = event.target.value;
  const last = safeStorage("get", `${CHANNEL_KEY}.${guildId}`);
  const channels = state.channels.filter((c) => c.guildId === guildId);
  switchChannel((channels.find((c) => c.id === last) || channels[0]).id);
});
$("login-button").onclick = login;
$("logout-button").addEventListener("click", logout);

// Re-check quickly when the tab or iframe becomes visible again
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.me && !state.socket) connect();
});

start();
