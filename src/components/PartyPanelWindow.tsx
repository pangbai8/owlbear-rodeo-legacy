import { useEffect, useRef } from "react";
import { IconButton } from "theme-ui";
import { useParams } from "react-router-dom";
import { useToasts } from "react-toast-notifications";

import FloatingWindow, { besidePartyRect } from "./FloatingWindow";
import OpenInNewIcon from "../icons/OpenInNewIcon";
import ClearDataIcon from "../icons/ClearDataIcon";
import {
  MonsterRef,
  isMonsterRef,
  loadMonster,
  lookupFiveE,
  openMonsterCard,
} from "../helpers/fiveETools";
import {
  PartyLink,
  emitPartyLinks,
  locateToken,
  autoAddMapMonsters,
  onAddMonsterToPartyPanel,
} from "../helpers/partyPanel";

/**
 * The GM party status panel (public/party-panel, see db-shim.js). With the
 * Cloudflare backend its data is shared by everyone in the game room;
 * otherwise it stays in this browser.
 */
const brokerUrl =
  process.env.REACT_APP_BROKER_TRANSPORT === "cloudflare"
    ? process.env.REACT_APP_BROKER_URL || ""
    : "";

export function partyPanelUrl(gameId: string) {
  const base = `${process.env.PUBLIC_URL}/party-panel/`;
  if (!brokerUrl) return base;
  const params = new URLSearchParams({ room: gameId, broker: brokerUrl });
  return `${base}?${params}`;
}

const isLink = (link: any): link is PartyLink =>
  !!link &&
  typeof link.tokenStateId === "string" &&
  typeof link.mapId === "string" &&
  typeof link.hp === "number" &&
  typeof link.maxHp === "number";

function PartyPanelWindow() {
  const { id: gameId }: { id: string } = useParams();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const url = partyPanelUrl(gameId);
  const { addToast } = useToasts();
  // Latest addToast for the listeners below (registered once)
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  // Messages from the panel, in this iframe or its pop-out window (the panel
  // stays loaded while this window is closed)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (event.origin !== window.location.origin || !data) return;
      const reply = (payload: object) =>
        (event.source as Window | null)?.postMessage(payload, window.location.origin);
      switch (data.type) {
        // A monster dropped on the panel: one loader serves map and panel
        case "party-panel-monster":
          loadMonster(data.ref as MonsterRef)
            .then((stats) =>
              reply({ type: "party-panel-monster-result", id: data.id, stats })
            )
            .catch((error) =>
              reply({
                type: "party-panel-monster-result",
                id: data.id,
                error: error instanceof Error ? error.message : String(error),
              })
            );
          break;
        // 📖 on an NPC the quick search added
        case "party-panel-open-monster":
          if (isMonsterRef(data.ref)) openMonsterCard(data.ref);
          break;
        // HP and turns of NPCs linked to map tokens
        case "party-panel-links":
          if (Array.isArray(data.links)) emitPartyLinks(data.links.filter(isLink));
          break;
        // 📍 on a linked NPC
        case "party-panel-locate":
          if (typeof data.tokenStateId === "string") locateToken(data.tokenStateId);
          break;
        // A condition or concentration chip (5e mode)
        case "party-panel-lookup":
          if (typeof data.name === "string" && data.name.trim()) {
            lookupFiveE(data.name.trim(), data.kind === "spell" ? "spell" : "condition")
              .then((found) => {
                if (!found) addToastRef.current(`5e 资料里没找到「${data.name}」`);
              })
              .catch(() => addToastRef.current("读取 5e 资料失败"));
          }
          break;
      }
    }
    window.addEventListener("message", handleMessage);
    // The panel may have sent its links before this page listened
    frameRef.current?.contentWindow?.postMessage(
      { type: "party-panel-links-request" },
      window.location.origin
    );
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // A monster dropped on the map with the panel's auto-add switch on: the
  // panel adds the NPC (linked to its token) and answers with its name
  useEffect(() => {
    let nextId = 1;
    const waiting = new Map<number, (data: any) => void>();
    function handleResult(event: MessageEvent) {
      const data = event.data;
      if (
        event.origin !== window.location.origin ||
        data?.type !== "party-panel-add-monster-result"
      ) {
        return;
      }
      waiting.get(data.id)?.(data);
      waiting.delete(data.id);
    }
    window.addEventListener("message", handleResult);
    const stop = onAddMonsterToPartyPanel(({ stats, link, resolve, reject }) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame) return reject(new Error("小队面板没有加载"));
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error("小队面板没有响应"));
      }, 8000);
      waiting.set(id, (data) => {
        clearTimeout(timer);
        if (data.error) reject(new Error(data.error));
        else resolve(String(data.name));
      });
      frame.postMessage(
        { type: "party-panel-add-monster", id, stats, link },
        window.location.origin
      );
    });
    return () => {
      stop();
      window.removeEventListener("message", handleResult);
    };
  }, []);

  function clearRoomData() {
    if (
      !window.confirm(
        "清空本房间的小队数据？\n\n房间里所有人的面板都会被清空，无法撤销。需要的话先在面板里用「导入 / 导出」备份。"
      )
    ) {
      return;
    }
    frameRef.current?.contentWindow?.postMessage(
      { type: "party-panel-clear" },
      window.location.origin
    );
  }

  return (
    <FloatingWindow
      name="partyPanel"
      title="小队状态"
      storageKey="partyPanelWindow.rect"
      defaultRect={() => besidePartyRect(0, 460)}
      // The GM's "地图怪物入队" switch needs the panel running from the start
      // (adding NPCs, their HP and turns on tokens), even before it is opened
      preload={autoAddMapMonsters()}
      headerActions={
        <>
          {brokerUrl && (
            <IconButton
              aria-label="Clear Party Data for This Room"
              title="清空本房间的小队数据"
              onClick={clearRoomData}
            >
              <ClearDataIcon />
            </IconButton>
          )}
          <IconButton
            aria-label="Open Party Panel in New Window"
            title="在新窗口打开小队状态"
            onClick={() =>
              window.open(url, "owlbear-party-panel", "popup,width=480,height=800")
            }
          >
            <OpenInNewIcon />
          </IconButton>
        </>
      }
    >
      <iframe
        ref={frameRef}
        src={url}
        title="小队状态"
        allow="clipboard-read; clipboard-write"
        style={{
          flexGrow: 1,
          width: "100%",
          border: "none",
          background: "#16181d",
        }}
      />
    </FloatingWindow>
  );
}

export default PartyPanelWindow;
