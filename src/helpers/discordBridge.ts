// Sends a message to the channel open in the VTT's Discord window (the
// discord-bridge page in an iframe), as the user signed in there.

/** Same as ChatWindow's discordChatUrl (not imported: ChatWindow uses this file) */
const discordChatUrl = process.env.REACT_APP_DISCORD_CHAT_URL || "";

export type Speaker = { name: string; avatarUrl?: string | null };

const TO_DISCORD_KEY = "fiveE.rollsToDiscord";

/** The 5e cards' "掷骰结果发到 Discord" switch (per browser) */
export function rollsToDiscord() {
  try {
    return localStorage.getItem(TO_DISCORD_KEY) === "true";
  } catch {
    return false;
  }
}

export function setRollsToDiscord(value: boolean) {
  try {
    localStorage.setItem(TO_DISCORD_KEY, String(value));
  } catch {}
}

let nextId = 1;

export function sendToDiscord(content: string, speaker?: Speaker) {
  return new Promise<void>((resolve, reject) => {
    if (!discordChatUrl) return reject(new Error("没有配置 Discord 聊天窗"));
    const origin = new URL(discordChatUrl, window.location.href).origin;
    const frame = Array.from(document.querySelectorAll("iframe")).find((f) =>
      f.src.startsWith(origin)
    );
    if (!frame?.contentWindow) {
      return reject(new Error("请先打开一次 Discord 聊天窗并登录"));
    }
    const id = nextId++;
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("Discord 聊天窗没有响应，请先打开它并登录"));
    }, 10000);
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (event.origin !== origin || data?.type !== "bridge-send-result" || data.id !== id) {
        return;
      }
      done();
      data.error ? reject(new Error(data.error)) : resolve();
    }
    window.addEventListener("message", onMessage);
    frame.contentWindow.postMessage(
      { type: "bridge-send", id, content, speaker: speaker || null },
      origin
    );
  });
}
