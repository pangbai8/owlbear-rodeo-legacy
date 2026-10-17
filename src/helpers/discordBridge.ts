// Dice rolls posted to Discord as well: the Discord window's page (the
// discord-bridge, in an iframe) sends them to the channel open there, as
// the user signed in there. The rules mode menu's switch turns it on
// (rollTarget.ts).

import { RollSummary } from "./fiveEDice";

/** The Discord chat window's iframe (ChatWindow) */
const FRAME_SELECTOR = 'iframe[data-chat="discordChat"]';
const TIMEOUT = 10000;

/** "🎲 **地精 弯刀 命中**：1d20+4 = **19**（15+4）" */
export function discordRollMessage(speaker: string | undefined, label: string, roll: RollSummary) {
  const name = `${speaker ? speaker + " " : ""}${label}`;
  return `🎲 **${name}**：${roll.expression} = **${roll.total}**${roll.rest}`;
}

let nextId = 1;

/** Post a roll to the channel open in the Discord window; rejects with what went wrong */
export function sendRollToDiscord(speaker: string | undefined, label: string, roll: RollSummary) {
  return new Promise<void>((resolve, reject) => {
    const frame = document.querySelector<HTMLIFrameElement>(FRAME_SELECTOR);
    const target = frame?.contentWindow;
    if (!frame || !target) {
      reject(new Error("Discord 窗口还没加载"));
      return;
    }
    const origin = new URL(frame.src, window.location.href).origin;
    const id = nextId++;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Discord 窗口没有回应（未加载完或没登录）"));
    }, TIMEOUT);
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (event.origin !== origin || event.source !== target) return;
      if (!data || data.type !== "bridge-send-result" || data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (data.error) reject(new Error(data.error));
      else resolve();
    }
    window.addEventListener("message", onMessage);
    // No speaker: it posts as the user, like the Boluo rolls
    target.postMessage(
      { type: "bridge-send", id, content: discordRollMessage(speaker, label, roll), speaker: null },
      origin
    );
  });
}
