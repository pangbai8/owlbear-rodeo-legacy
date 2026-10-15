import { useRef } from "react";
import { IconButton } from "theme-ui";
import { useParams } from "react-router-dom";

import FloatingWindow, { besidePartyRect } from "./FloatingWindow";
import OpenInNewIcon from "../icons/OpenInNewIcon";
import ClearDataIcon from "../icons/ClearDataIcon";

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

function PartyPanelWindow() {
  const { id: gameId }: { id: string } = useParams();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const url = partyPanelUrl(gameId);

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
