import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Flex, Select, Text } from "theme-ui";

import FloatingWindow, { besidePartyRect } from "./FloatingWindow";
import {
  SheetMeta,
  deleteSheet,
  editorOpenExt,
  editorSaveExt,
  getSheetFile,
  importAccept,
  listSheets,
  putSheet,
  splitFileName,
} from "../helpers/characterSheets";

/** Static OnlyOffice-in-the-browser editor (ranuts/document) */
export const sheetEditorUrl = process.env.REACT_APP_SHEET_EDITOR_URL || "";

const CURRENT_STORAGE_KEY = "characterSheets.current";
const AUTOSAVE_DELAY = 3000;

type SaveWaiter = { resolve: () => void; reject: (error: Error) => void };

function clearSaveTimer(
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>
) {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }
}

function editorSrc() {
  const url = new URL("/editor", sheetEditorUrl);
  url.searchParams.set("embed", "1");
  url.searchParams.set("embedOrigin", window.location.origin);
  url.searchParams.set("locale", navigator.language || "en");
  return url.toString();
}

function loadCurrentId() {
  try {
    return localStorage.getItem(CURRENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Character sheets (Excel / Word files) kept in this browser and edited in an
 * embedded editor. Edits are saved back to IndexedDB shortly after they stop.
 */
function SheetWindow() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(loadCurrentId);
  const [isReady, setIsReady] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [status, setStatus] = useState("");

  // The sheet the editor currently holds, which may lag behind currentId
  const openedRef = useRef<SheetMeta | null>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const saveWaitersRef = useRef<SaveWaiter[]>([]);

  const refreshSheets = useCallback(async () => {
    const list = await listSheets();
    setSheets(list);
    return list;
  }, []);

  const send = useCallback((type: string, payload: object = {}) => {
    const target = iframeRef.current?.contentWindow;
    if (!target) {
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    target.postMessage({ id, type, payload }, new URL(sheetEditorUrl).origin);
  }, []);

  const requestSave = useCallback((): Promise<void> => {
    clearSaveTimer(saveTimerRef);
    const opened = openedRef.current;
    if (!opened) {
      return Promise.resolve();
    }
    setStatus("Saving…");
    return new Promise((resolve, reject) => {
      saveWaitersRef.current.push({ resolve, reject });
      send("document:save", {
        targetExt: editorSaveExt(opened.ext).toUpperCase(),
      });
    });
  }, [send]);

  const scheduleSave = useCallback(() => {
    clearSaveTimer(saveTimerRef);
    saveTimerRef.current = setTimeout(() => {
      requestSave().catch(() => {});
    }, AUTOSAVE_DELAY);
  }, [requestSave]);

  /** Save pending edits, then show another sheet in the editor */
  const openSheet = useCallback(
    async (id: string | null) => {
      if (dirtyRef.current) {
        await requestSave();
      }
      setCurrentId(id);
      try {
        if (id) {
          localStorage.setItem(CURRENT_STORAGE_KEY, id);
        } else {
          localStorage.removeItem(CURRENT_STORAGE_KEY);
        }
      } catch {}
      const meta = (await listSheets()).find((sheet) => sheet.id === id);
      const data = meta && (await getSheetFile(meta.id));
      if (!meta || !data) {
        openedRef.current = null;
        return;
      }
      openedRef.current = meta;
      setStatus("Opening…");
      send("document:open-buffer", {
        fileName: `${meta.name}.${editorOpenExt(meta.ext)}`,
        buffer: data,
        readonly: false,
      });
    },
    [requestSave, send]
  );

  useEffect(() => {
    refreshSheets();
  }, [refreshSheets]);

  useEffect(() => {
    async function handleMessage(event: MessageEvent) {
      if (
        event.source !== iframeRef.current?.contentWindow ||
        event.origin !== new URL(sheetEditorUrl).origin
      ) {
        return;
      }
      const { type, payload } = event.data || {};
      if (type === "document:ready") {
        setIsReady(true);
      } else if (type === "document:opened") {
        setStatus("");
      } else if (type === "document:dirty-changed") {
        dirtyRef.current = !!payload?.dirty;
        setIsDirty(dirtyRef.current);
        if (dirtyRef.current) {
          scheduleSave();
        }
      } else if (type === "document:saved") {
        const opened = openedRef.current;
        const waiters = saveWaitersRef.current.splice(0);
        try {
          if (opened && payload?.file) {
            const data: ArrayBuffer = await payload.file.arrayBuffer();
            openedRef.current = await putSheet(
              {
                id: opened.id,
                name: opened.name,
                ext: editorSaveExt(opened.ext),
              },
              data
            );
            await refreshSheets();
          }
          dirtyRef.current = !!payload?.dirty;
          setIsDirty(dirtyRef.current);
          setStatus("Saved");
          if (dirtyRef.current) {
            // Edits made during the export still need saving
            scheduleSave();
          }
          waiters.forEach((waiter) => waiter.resolve());
        } catch (error) {
          setStatus("Unable to save");
          waiters.forEach((waiter) => waiter.reject(error as Error));
        }
      } else if (type === "document:error") {
        const message = String(payload?.message || "Editor error");
        setStatus(message);
        saveWaitersRef.current
          .splice(0)
          .forEach((waiter) => waiter.reject(new Error(message)));
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [refreshSheets, scheduleSave]);

  // Open the last used sheet once the editor is ready
  useEffect(() => {
    if (isReady && currentId && !openedRef.current) {
      openSheet(currentId);
    }
    // Only on readiness; later switches go through openSheet directly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearSaveTimer(saveTimerRef);
    };
  }, []);

  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = importAccept;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      const [name, ext] = splitFileName(file.name);
      const meta = await putSheet({ name, ext }, await file.arrayBuffer());
      await refreshSheets();
      await openSheet(meta.id);
    };
    input.click();
  }

  async function handleDownload() {
    const opened = openedRef.current;
    if (!opened) {
      return;
    }
    if (dirtyRef.current) {
      await requestSave();
    }
    const data = await getSheetFile(opened.id);
    if (!data) {
      return;
    }
    const url = URL.createObjectURL(new Blob([data]));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${opened.name}.${openedRef.current?.ext || opened.ext}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleDelete() {
    const opened = sheets.find((sheet) => sheet.id === currentId);
    if (
      !opened ||
      !window.confirm(`Delete "${opened.name}" from this browser?`)
    ) {
      return;
    }
    clearSaveTimer(saveTimerRef);
    dirtyRef.current = false;
    setIsDirty(false);
    openedRef.current = null;
    await deleteSheet(opened.id);
    const remaining = await refreshSheets();
    await openSheet(remaining[0]?.id || null);
  }

  const hasSheet = !!sheets.find((sheet) => sheet.id === currentId);

  return (
    <>
      <Flex
        px={2}
        pb={1}
        sx={{ alignItems: "center", gap: "4px", flexWrap: "wrap" }}
      >
        <Select
          aria-label="Character Sheet"
          value={hasSheet && currentId ? currentId : ""}
          onChange={(event) => openSheet(event.target.value || null)}
          sx={{ minWidth: "140px", py: 1 }}
          disabled={!isReady || sheets.length === 0}
        >
          {sheets.length === 0 && <option value="">No sheets yet</option>}
          {sheets.map((sheet) => (
            <option key={sheet.id} value={sheet.id}>
              {sheet.name}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          py={1}
          onClick={handleImport}
          disabled={!isReady}
        >
          Import
        </Button>
        <Button
          variant="secondary"
          py={1}
          onClick={handleDownload}
          disabled={!hasSheet}
        >
          Download
        </Button>
        <Button
          variant="secondary"
          py={1}
          onClick={handleDelete}
          disabled={!hasSheet}
        >
          Delete
        </Button>
        <Text variant="caption" sx={{ flexGrow: 1, textAlign: "right" }}>
          {!isReady ? "Loading editor…" : isDirty ? "Unsaved" : status}
        </Text>
      </Flex>
      <Box sx={{ position: "relative", flexGrow: 1 }}>
        <iframe
          ref={iframeRef}
          src={editorSrc()}
          title="Character Sheet Editor"
          allow="clipboard-read; clipboard-write; fullscreen"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: "none",
            background: "white",
            visibility: hasSheet ? "visible" : "hidden",
          }}
        />
        {!hasSheet && (
          <Flex
            sx={{
              position: "absolute",
              inset: 0,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              textAlign: "center",
            }}
            p={3}
          >
            <Text>
              Import an Excel or Word character sheet. It stays in this browser
              only.
            </Text>
          </Flex>
        )}
      </Box>
    </>
  );
}

function SheetFloatingWindow() {
  if (!sheetEditorUrl) {
    return null;
  }
  return (
    <FloatingWindow
      name="sheets"
      title="Character Sheets"
      storageKey="sheetWindow.rect"
      defaultRect={() => besidePartyRect(0, 900)}
    >
      <SheetWindow />
    </FloatingWindow>
  );
}

export default SheetFloatingWindow;
