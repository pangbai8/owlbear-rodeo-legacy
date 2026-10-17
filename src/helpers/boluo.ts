// Dice rolls from the cards posted to Boluo as well: the Boluo window's page
// (the same-site mirror, see boluo-mirror/bridge.mjs) sends them with the
// user's own Boluo login to the channel open there. A switch in the rules
// mode menu turns it on; stored per browser.

import { useEffect, useState } from "react";

import { RollSummary } from "./fiveEDice";

const KEY = "boluo.sendRolls";
const CHANGE_EVENT = "boluo.sendRolls:change";
/** The Boluo chat window's iframe (ChatWindow) */
const FRAME_SELECTOR = 'iframe[data-chat="chat"]';
const TIMEOUT = 8000;

export function sendsRollsToBoluo() {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function setSendsRollsToBoluo(on: boolean) {
  try {
    localStorage.setItem(KEY, String(on));
  } catch {}
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: on }));
}

export function useSendsRollsToBoluo() {
  const [on, setOn] = useState(sendsRollsToBoluo);
  useEffect(() => {
    const handler = (event: Event) => setOn((event as CustomEvent).detail as boolean);
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);
  return on;
}

type Entity =
  | { type: "Text"; start: number; len: number }
  | { type: "Strong"; start: number; len: number; child: { type: "Text"; start: number; len: number } };

/** "地精 弯刀 命中：1d20+4 = 19（15+4）", the total in bold */
export function boluoRollMessage(speaker: string | undefined, label: string, roll: RollSummary) {
  const head = `${speaker ? speaker + " " : ""}${label}：${roll.expression} = `;
  const total = String(roll.total);
  const rest = roll.rest;
  const text = head + total + rest;
  const span = (start: number, len: number) => ({ start, len });
  const entities: Entity[] = [
    { type: "Text", ...span(0, head.length) },
    {
      type: "Strong",
      ...span(head.length, total.length),
      child: { type: "Text", ...span(head.length, total.length) },
    },
  ];
  if (rest) entities.push({ type: "Text", ...span(head.length + total.length, rest.length) });
  return { text, entities };
}

let nextId = 1;

/**
 * Post a roll to the channel open in the Boluo window. It speaks as the
 * Boluo window would right now: in or out of game by the channel and the
 * compose box (.in / .out / .as), under the user's name or character.
 * speaker: the monster that rolls, named in the text. Resolves with who
 * spoke, or rejects with what went wrong.
 */
export function sendRollToBoluo(speaker: string | undefined, label: string, roll: RollSummary) {
  return new Promise<{ name: string; inGame: boolean }>((resolve, reject) => {
    const frame = document.querySelector<HTMLIFrameElement>(FRAME_SELECTOR);
    const target = frame?.contentWindow;
    if (!frame || !target) {
      reject(new Error("Boluo 窗口还没加载"));
      return;
    }
    const origin = new URL(frame.src, window.location.href).origin;
    const id = nextId++;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Boluo 窗口没有回应（未加载完或不是镜像站）"));
    }, TIMEOUT);
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (event.origin !== origin || event.source !== target) return;
      if (!data || data.type !== "boluo-roll-result" || data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (data.ok) resolve({ name: String(data.name || ""), inGame: !!data.inGame });
      else reject(new Error(data.error || "发送失败"));
    }
    window.addEventListener("message", onMessage);
    const { text, entities } = boluoRollMessage(speaker, label, roll);
    target.postMessage({ type: "boluo-roll", id, text, entities }, origin);
  });
}
