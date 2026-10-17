import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";

import Session, { PeerDataEvent } from "./Session";
import { useUserId } from "../contexts/UserIdContext";
import { useParty } from "../contexts/PartyContext";
import type { Map as MapType } from "../types/Map";
import {
  PartyChange,
  PartyOp,
  PartyOpError,
  PartySnapshot,
  applyOp,
  emptySnapshot,
  isSnapshot,
  loadLocalSnapshot,
  newestSnapshot,
  receiveChange,
  saveLocalSnapshot,
} from "../helpers/partyData";

/** The party panel's server (only to move a room's old data off it once) */
const brokerUrl =
  process.env.REACT_APP_BROKER_TRANSPORT === "cloudflare"
    ? process.env.REACT_APP_BROKER_URL || ""
    : "";

// How long a new host waits for the other players' copies
const COLLECT_MS = 1500;
// How long a change sent to the host may wait for its answer
const OP_TIMEOUT_MS = 10000;

type PanelStatus = { readOnly: boolean; status: string };

/**
 * The party panel's data, held by the current map's owner (see
 * helpers/partyData.ts) and passed between the players over WebRTC. The
 * panel (iframe or popup) talks to this page with postMessage:
 * party-data-hello / party-data-op in; party-data-all / party-data-change /
 * party-data-ack / party-data-status out.
 */
function NetworkedPartyData({ session, map }: { session: Session; map: MapType | null }) {
  const { id: room }: { id: string } = useParams();
  const userId = useUserId();
  const partyState = useParty();

  const hostUserId = map?.owner || null;
  const amHost = !!hostUserId && hostUserId === userId;
  const hostPeer = Object.entries(partyState).find(([, p]) => p.userId === hostUserId);
  const hostSessionId = !amHost && hostPeer ? hostPeer[0] : null;

  // Everything the handlers need, current on every render
  const live = useRef({ amHost, hostSessionId, hostUserId, partyState });
  live.current = { amHost, hostSessionId, hostUserId, partyState };

  const snap = useRef<PartySnapshot>(emptySnapshot());
  const loaded = useRef(false);
  // A new host collecting the others' copies; changes wait until it is done
  const adopting = useRef(false);
  const dumps = useRef<PartySnapshot[]>([]);
  const queued = useRef<{ op: PartyOp; done: (code?: string) => void }[]>([]);
  // The panel windows (iframe, popup) that said hello
  const panels = useRef(new Set<Window>());
  // Changes sent to the host, by request id
  const waiting = useRef(new Map<number, (code?: string) => void>());
  const nextRequest = useRef(1);

  /* ---------- the panel windows ---------- */

  function post(message: any, only?: Window) {
    const targets = only ? [only] : Array.from(panels.current);
    for (const w of targets) {
      try {
        if (w.closed) panels.current.delete(w);
        else w.postMessage(message, window.location.origin);
      } catch {
        panels.current.delete(w);
      }
    }
  }

  function panelStatus(): PanelStatus {
    const { amHost, hostSessionId, hostUserId } = live.current;
    if (!hostUserId)
      return { readOnly: true, status: "放上地图后才能修改小队面板：数据由地图主人保管。" };
    if (amHost) return adopting.current ? { readOnly: true, status: "正在同步小队数据…" } : { readOnly: false, status: "" };
    if (!hostSessionId)
      return {
        readOnly: true,
        status: "地图主人不在线，现在显示的是本机保存的内容，暂时不能修改。",
      };
    return { readOnly: false, status: "" };
  }

  function sendStatus(only?: Window) {
    post({ type: "party-data-status", ...panelStatus() }, only);
  }

  function sendAll(only?: Window) {
    post({ type: "party-data-all", docs: snap.current.docs }, only);
  }

  /** This browser's copy changed: keep it and show it */
  function setSnapshot(next: PartySnapshot, change?: PartyChange) {
    snap.current = next;
    saveLocalSnapshot(room, next);
    if (change?.kind === "doc") post({ type: "party-data-change", path: change.path, data: change.data });
    else sendAll();
  }

  /* ---------- the host ---------- */

  function otherSessions() {
    return Object.keys(live.current.partyState);
  }

  function broadcast(id: string, data: any) {
    for (const sessionId of otherSessions()) session.sendTo(sessionId, id, data);
  }

  function hostApply(op: PartyOp, done: (code?: string) => void) {
    if (adopting.current) {
      queued.current.push({ op, done });
      return;
    }
    try {
      const { snapshot, change } = applyOp(snap.current, op);
      setSnapshot(snapshot, change);
      broadcast("partyChange", change);
      done();
    } catch (e) {
      done(e instanceof PartyOpError ? e.code : "unavailable");
    }
  }

  /** Becoming the host: carry on from the newest copy among the players online */
  async function adopt() {
    adopting.current = true;
    sendStatus();
    dumps.current = [];
    broadcast("partyDumpRequest", null);
    await new Promise((resolve) => setTimeout(resolve, COLLECT_MS));
    if (!live.current.amHost) {
      adopting.current = false;
      return;
    }
    let best = newestSnapshot([snap.current, ...dumps.current]);
    // A room used before: its data is still on the server, moved here once
    // (The server's copy is left as it was; nothing writes to it any more,
    // and the server drops it 90 days after its last use.)
    if (best.version === 0 && !best.serverChecked) {
      const old = await serverParty(room);
      if (old) {
        const found = Object.keys(old).length > 0;
        best = { docs: old, version: found ? 1 : 0, updated: Date.now(), serverChecked: true };
      }
    }
    if (!live.current.amHost) {
      adopting.current = false;
      return;
    }
    adopting.current = false;
    setSnapshot({ ...best, serverChecked: best.serverChecked || snap.current.serverChecked });
    broadcast("partySnapshot", snap.current);
    sendStatus();
    const ops = queued.current;
    queued.current = [];
    for (const { op, done } of ops) hostApply(op, done);
  }

  /* ---------- a change from a panel ---------- */

  function handleOp(op: PartyOp, done: (code?: string) => void) {
    const { amHost, hostSessionId } = live.current;
    if (amHost) return hostApply(op, done);
    if (!hostSessionId) return done("unavailable");
    const rid = nextRequest.current++;
    const timer = window.setTimeout(() => {
      waiting.current.delete(rid);
      done("unavailable");
    }, OP_TIMEOUT_MS);
    waiting.current.set(rid, (code) => {
      window.clearTimeout(timer);
      done(code);
    });
    session.sendTo(hostSessionId, "partyOp", { rid, op });
  }

  /* ---------- effects ---------- */

  // This browser's copy, then ask the host for the current one
  useEffect(() => {
    let cancelled = false;
    loadLocalSnapshot(room).then((local) => {
      if (cancelled) return;
      snap.current = newestSnapshot([local, snap.current]);
      loaded.current = true;
      sendAll();
      sendStatus();
      if (live.current.amHost) adopt();
      else if (live.current.hostSessionId)
        session.sendTo(live.current.hostSessionId, "partyHello", { version: snap.current.version });
    });
    // Keep this site's data from being cleared by the browser (not in
    // Firefox, which would ask the user)
    if (!/Firefox\//.test(navigator.userAgent)) navigator.storage?.persist?.().catch(() => {});
    return () => {
      cancelled = true;
    };
    // Once per room
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // The map changed hands, or the host came or went
  useEffect(() => {
    if (!loaded.current) return;
    sendStatus();
    if (amHost) adopt();
    else if (hostSessionId) session.sendTo(hostSessionId, "partyHello", { version: snap.current.version });
    // Only when the host changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amHost, hostSessionId]);

  // Messages from the other players
  useEffect(() => {
    function handlePeerData({ peer, id, data, reply }: PeerDataEvent) {
      const fromHost = peer.id === live.current.hostSessionId;
      if (id === "partyHello") {
        if (live.current.amHost && !adopting.current) reply("partySnapshot", snap.current);
      } else if (id === "partyOp") {
        if (!live.current.amHost || !data || typeof data.rid !== "number") return;
        hostApply(data.op, (code) => reply("partyAck", { rid: data.rid, code }));
      } else if (id === "partyAck") {
        const done = data && waiting.current.get(data.rid);
        if (done) {
          waiting.current.delete(data.rid);
          done(data.code || undefined);
        }
      } else if (id === "partyChange") {
        if (!fromHost) return;
        const next = receiveChange(snap.current, data);
        if (next === null) session.sendTo(peer.id, "partyHello", { version: snap.current.version });
        else if (next !== snap.current) setSnapshot(next, data);
      } else if (id === "partySnapshot") {
        // The host's copy is the one that counts
        if (fromHost && isSnapshot(data)) setSnapshot(data);
      } else if (id === "partyDumpRequest") {
        reply("partyDump", snap.current);
      } else if (id === "partyDump") {
        if (live.current.amHost && adopting.current && isSnapshot(data)) dumps.current.push(data);
      }
    }
    session.on("peerData", handlePeerData);
    return () => {
      session.off("peerData", handlePeerData);
    };
    // The handlers read live.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // The panel windows
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (event.origin !== window.location.origin || !data || typeof data.type !== "string") return;
      const source = event.source as Window | null;
      if (!source) return;
      if (data.type === "party-data-hello") {
        panels.current.add(source);
        sendAll(source);
        sendStatus(source);
      } else if (data.type === "party-data-op") {
        panels.current.add(source);
        const op: PartyOp =
          data.op === "clear"
            ? { op: "clear" }
            : data.op === "delete"
            ? { op: "delete", path: data.path }
            : { op: "set", path: data.path, data: data.data };
        handleOp(op, (code) => post({ type: "party-data-ack", id: data.id, code }, source));
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // The handlers read live.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/**
 * A room's party data from before, on the server (/party/ws), read with
 * the game password. null when it cannot be reached.
 */
function serverParty(room: string): Promise<Record<string, any> | null> {
  if (!brokerUrl) return Promise.resolve(null);
  let password = "";
  try {
    password = sessionStorage.getItem("auth") || "";
  } catch {}
  return new Promise((resolve) => {
    let result: Record<string, any> | null = null;
    let finished = false;
    const ws = new WebSocket(`${brokerUrl.replace(/^http/, "ws")}/party/ws?room=${encodeURIComponent(room)}`);
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(result);
    };
    const timer = window.setTimeout(finish, 8000);
    ws.onopen = () => ws.send(JSON.stringify({ op: "auth", password }));
    ws.onmessage = (event) => {
      let m: any;
      try {
        m = JSON.parse(event.data);
      } catch {
        return;
      }
      if (m.t === "ready") {
        result = m.docs && typeof m.docs === "object" ? m.docs : {};
        finish();
      } else if (m.t === "error") {
        finish();
      }
    };
    ws.onerror = finish;
    ws.onclose = finish;
  });
}

export default NetworkedPartyData;
