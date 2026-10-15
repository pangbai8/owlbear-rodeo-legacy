// Login popup landing page: tell the chat page and close the popup.
const ERRORS = {
  denied: "你取消了授权。",
  state: "登录已过期，请回到聊天窗口重新登录。",
  token: "Discord 登录失败，请重试。",
  not_member: "你不在这个 Discord 服务器里，请先加入服务器。",
  missing_role: "你没有使用这个聊天窗口所需的身份组。",
  server: "服务器出错了，请稍后再试。",
};

const error = new URLSearchParams(location.search).get("error");
if (error) {
  document.getElementById("title").textContent = "登录失败";
  document.getElementById("message").textContent = ERRORS[error] || ERRORS.server;
}

const message = { type: "discord-bridge-login", ok: !error, error };
try {
  new BroadcastChannel("discord-bridge-auth").postMessage(message);
} catch {}
try {
  window.opener?.postMessage(message, location.origin);
} catch {}
// A popup closes itself; when the login ran in this tab instead (or close() is ignored), go back to the chat
if (!error) {
  setTimeout(() => window.close(), 600);
  setTimeout(() => location.replace("/"), 900);
}
